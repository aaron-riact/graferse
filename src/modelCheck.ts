// Explicit-state model checker for Graferse.  Test-only: index.ts does not
// export it, so it is never published.
//
// It drives the real Graferse, not a model of its rules.  A scenario is a
// graph plus agents with fixed paths.  Every agent starts off the graph on a
// private pseudo-node (as fleet-manager's approach legs do) and ends by
// leaving it.  The only choice in the world is which agent acts next, so the
// checker walks every interleaving:
//
//   enter   arrivedAt(0) on the pseudo-node
//   move    arrivedAt(i + 1), allowed once Graferse granted index i + 1
//   leave   clearAllPathLocks at the last node
//
// Staying still is covered for free: an agent that does not act in a
// schedule is an agent stopped for as long as that schedule lasts.
//
// Each state is rebuilt by replaying the actions that reach it, since Graferse
// cannot be cloned.  States are deduplicated by agent positions, grants and
// lock contents.  For the scenarios given, a clean result is a proof, not a
// sample: no reachable state deadlocks or breaks an invariant.

import { Graferse } from './graph.js'
import type { Lock, LinkLock, NextNode } from './graph.js'

export interface Topology {
    nodes: string[]
    links: Array<{ from: string, to: string, bidirectional?: boolean }>
}

export interface AgentSpec {
    name: string
    // real node ids, in order; the pseudo start is added in front
    path: string[]
}

export interface Scenario {
    topology: Topology
    agents: AgentSpec[]
    // lock groups, as node ids: each group is one space only one agent holds
    lockGroups?: string[][]
    // hand the directed links to setTopology, so the walk reserves through
    // groups joined in both directions
    setTopology?: boolean
    // declare every loop of one-way links with setLoops (capacity N - 1)
    loops?: boolean
    // give up (and say so) past this many distinct states
    maxStates?: number
}

// What a state looks like from outside, for properties beyond the built-in ones
export interface StateView {
    // real node the agent stands on, undefined while off the graph
    at(agent: string): string | undefined
    // real nodes the agent holds a lock on, sorted
    holds(agent: string): string[]
}

export interface Finding {
    kind: 'deadlock' | 'violation'
    message: string
    // the schedule that reaches it, as "A enter", "B move b", "A leave"
    trace: string[]
}

export interface CheckResult {
    states: number
    // true when maxStates cut the search short: then a clean result proves nothing
    truncated: boolean
    findings: Finding[]
}

type Phase = 'outside' | 'on' | 'gone'

interface Agent {
    spec: AgentSpec
    path: string[]
    phase: Phase
    index: number
    granted: Set<number>
    locker?: {
        arrivedAt(index: number): void
        clearAllPathLocks(): void
    }
}

interface World {
    agents: Agent[]
    nodeLocks: Map<string, Lock>
    linkLocks: Map<string, LinkLock>
}

const pseudo = (name: string) => `^${name}`
const linkKey = (from: string, to: string) => `${from}>${to}`

function build(scenario: Scenario): World {
    const creator = new Graferse<string>(x => x)
    const nodeLocks = new Map(scenario.topology.nodes.map(id => [id, creator.makeLock(id)]))
    const linkLocks = new Map<string, LinkLock>()
    for (const { from, to, bidirectional } of scenario.topology.links) {
        const lock = creator.makeLinkLock(from, to, bidirectional ?? false)
        linkLocks.set(linkKey(from, to), lock)
        if (bidirectional) linkLocks.set(linkKey(to, from), lock)
    }
    // pseudo-nodes are private to one agent, so their locks are always free
    const pseudoLocks = new Map<string, Lock>()
    const pseudoLinks = new Map<string, LinkLock>()
    const getLock = (id: string) => {
        const real = nodeLocks.get(id)
        if (real) return real
        if (!id.startsWith('^')) throw new Error(`scenario walks unknown node ${id}`)
        let lock = pseudoLocks.get(id)
        if (!lock) pseudoLocks.set(id, lock = creator.makeLock(id))
        return lock
    }
    const getLockForLink = (from: string, to: string) => {
        const real = linkLocks.get(linkKey(from, to))
        if (real) return real
        if (!from.startsWith('^')) throw new Error(`scenario walks unknown link ${from} -> ${to}`)
        let lock = pseudoLinks.get(linkKey(from, to))
        if (!lock) pseudoLinks.set(linkKey(from, to), lock = creator.makeLinkLock(from, to, false))
        return lock
    }
    for (const group of scenario.lockGroups ?? []) {
        creator.setLockGroup(group.map(id => nodeLocks.get(id)!))
    }
    if (scenario.setTopology) {
        const directed: Array<[Lock, Lock]> = []
        for (const { from, to, bidirectional } of scenario.topology.links) {
            directed.push([nodeLocks.get(from)!, nodeLocks.get(to)!])
            if (bidirectional) directed.push([nodeLocks.get(to)!, nodeLocks.get(from)!])
        }
        creator.setTopology(directed)
    }
    if (scenario.loops) {
        const oneway = scenario.topology.links
            .filter(link => !link.bidirectional)
            .map(({ from, to }): [Lock, Lock] => [nodeLocks.get(from)!, nodeLocks.get(to)!])
        creator.setLoops(creator.findLoops(oneway))
    }
    const makeLocker = creator.makeMakeLocker(getLock, getLockForLink)
    const agents = scenario.agents.map((spec): Agent => ({
        spec,
        path: [pseudo(spec.name), ...spec.path],
        phase: 'outside',
        index: -1,
        granted: new Set(),
    }))
    for (const agent of agents) {
        const path = makeLocker(agent.spec.name).makePathLocker(agent.path)
        agent.locker = path((next: NextNode[]) => {
            agent.granted = new Set(next.map(n => n.index))
        })
    }
    return { agents, nodeLocks, linkLocks }
}

// agent indexes that can act in this state
function enabled(world: World): number[] {
    const out: number[] = []
    world.agents.forEach((agent, i) => {
        if (agent.phase === 'outside') out.push(i)
        else if (agent.phase === 'on') {
            const last = agent.path.length - 1
            if (agent.index === last || agent.granted.has(agent.index + 1)) out.push(i)
        }
    })
    return out
}

// performs one action and names it for traces
function act(world: World, i: number): string {
    const agent = world.agents[i]
    const name = agent.spec.name
    if (agent.phase === 'outside') {
        agent.phase = 'on'
        agent.index = 0
        agent.locker!.arrivedAt(0)
        return `${name} enter`
    }
    if (agent.index === agent.path.length - 1) {
        agent.phase = 'gone'
        agent.granted = new Set()
        agent.locker!.clearAllPathLocks()
        return `${name} leave`
    }
    agent.index += 1
    agent.locker!.arrivedAt(agent.index)
    return `${name} move ${agent.path[agent.index]}`
}

function realNodeOf(agent: Agent): string | undefined {
    if (agent.phase !== 'on' || agent.index < 1) return undefined
    return agent.path[agent.index]
}

function view(world: World): StateView {
    const byName = (name: string) => {
        const agent = world.agents.find(a => a.spec.name === name)
        if (!agent) throw new Error(`no agent ${name}`)
        return agent
    }
    return {
        at: name => realNodeOf(byName(name)),
        holds: name => [...world.nodeLocks]
            .filter(([, lock]) => lock.isLocked(name))
            .map(([id]) => id)
            .sort(),
    }
}

// built-in safety: one agent per node, and every agent owns the node it is on
function violations(world: World): string[] {
    const out: string[] = []
    const seen = new Map<string, string>()
    for (const agent of world.agents) {
        const node = realNodeOf(agent)
        if (node === undefined) continue
        const other = seen.get(node)
        if (other) out.push(`${agent.spec.name} and ${other} both on ${node}`)
        seen.set(node, agent.spec.name)
        if (!world.nodeLocks.get(node)!.isLocked(agent.spec.name)) {
            out.push(`${agent.spec.name} is on ${node} without holding it`)
        }
    }
    return out
}

function key(world: World): string {
    const sorted = (set: Iterable<string | number>) => [...set].map(String).sort()
    const links = new Set(world.linkLocks.values())
    return JSON.stringify({
        agents: world.agents.map(a => [a.phase, a.index, sorted(a.granted)]),
        nodes: [...world.nodeLocks].map(([id, lock]) => [id, sorted(lock.lockedBy), sorted(lock.waiting)]),
        links: [...links].map(link => {
            const { lockers, waiters } = link.getDetails()
            const dirs = (m: Map<string, Set<string>>) =>
                [...m].map(([dir, who]) => [dir, sorted(who)]).sort()
            return [link.from, link.to, dirs(lockers), dirs(waiters)]
        }),
    })
}

/**
 * Walk every reachable state of the scenario.  Reports deadlocks (some
 * agent not gone, nobody able to act), built-in invariant violations, and
 * Graferse throwing.  onState sees each distinct state once, for
 * properties of your own; return a string from it to report a violation.
 */
export function check(
    scenario: Scenario,
    onState?: (state: StateView) => string | undefined,
): CheckResult {
    const maxStates = scenario.maxStates ?? 50_000
    const findings: Finding[] = []
    const visited = new Set<string>()
    const queue: number[][] = [[]]
    let truncated = false

    while (queue.length > 0) {
        const schedule = queue.shift()!
        const world = build(scenario)
        const trace: string[] = []
        try {
            for (const i of schedule) trace.push(act(world, i))
        } catch (error) {
            findings.push({ kind: 'violation', message: `graferse threw: ${(error as Error).message}`, trace })
            continue
        }
        const k = key(world)
        if (visited.has(k)) continue
        visited.add(k)
        if (visited.size > maxStates) {
            truncated = true
            break
        }

        for (const message of violations(world)) findings.push({ kind: 'violation', message, trace })
        const custom = onState?.(view(world))
        if (custom) findings.push({ kind: 'violation', message: custom, trace })

        const next = enabled(world)
        if (next.length === 0) {
            const stuck = world.agents.filter(a => a.phase !== 'gone')
            if (stuck.length > 0) {
                findings.push({
                    kind: 'deadlock',
                    message: stuck.map(a => `${a.spec.name} at ${a.path[a.index] ?? 'outside'}`).join(', '),
                    trace,
                })
            }
            continue
        }
        for (const i of next) queue.push([...schedule, i])
    }
    return { states: visited.size, truncated, findings }
}
