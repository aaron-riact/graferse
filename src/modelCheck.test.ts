import { check, feasible, violations } from './modelCheck.js'
import type { Scenario } from './modelCheck.js'

const bi = (from: string, to: string) => ({ from, to, bidirectional: true })
const oneway = (from: string, to: string) => ({ from, to })

// A clean result only proves something if the whole space was walked
const expectExhaustive = (result: ReturnType<typeof check>) => {
    expect(result.truncated).toBe(false)
    expect(result.states).toBeGreaterThan(0)
}

describe('model check: safety invariants', () => {
    test('reports opposing holders of one bidirectional link', () => {
        const link = {
            from: 'a',
            to: 'b',
            getDetails: () => ({
                lockers: new Map([
                    ['a', new Set(['A'])],
                    ['b', new Set(['B'])],
                ]),
                waiters: new Map(),
            }),
        }
        const world = {
            agents: [],
            nodeLocks: new Map(),
            linkLocks: new Map([['a>b', link], ['b>a', link]]),
        } as unknown as Parameters<typeof violations>[0]

        expect(violations(world)).toEqual([
            'A and B hold a <-> b in opposite directions',
        ])
    })
})

describe('model check: deadlock freedom', () => {
    const cases: Array<[string, Scenario]> = [
        ['two agents swap ends of a bidirectional corridor', {
            topology: { nodes: ['a', 'b', 'c'], links: [bi('a', 'b'), bi('b', 'c')] },
            agents: [
                { name: 'A', path: ['a', 'b', 'c'] },
                { name: 'B', path: ['c', 'b', 'a'] },
            ],
        }],
        ['two agents follow each other down a bidirectional corridor', {
            topology: { nodes: ['a', 'b', 'c'], links: [bi('a', 'b'), bi('b', 'c')] },
            agents: [
                { name: 'A', path: ['a', 'b', 'c'] },
                { name: 'B', path: ['a', 'b', 'c'] },
            ],
        }],
        ['a worker visits a dead-end spur while traffic passes on the lane', {
            topology: {
                nodes: ['p', 'L', 'q', 'S'],
                links: [oneway('p', 'L'), oneway('L', 'q'), bi('L', 'S')],
            },
            agents: [
                { name: 'W', path: ['p', 'L', 'S', 'L', 'q'] },
                { name: 'T', path: ['p', 'L', 'q'] },
            ],
        }],
        ['two workers share one dead-end spur', {
            topology: {
                nodes: ['p', 'L', 'q', 'S'],
                links: [oneway('p', 'L'), oneway('L', 'q'), bi('L', 'S')],
            },
            agents: [
                { name: 'W', path: ['p', 'L', 'S', 'L', 'q'] },
                { name: 'V', path: ['p', 'L', 'S', 'L', 'q'] },
            ],
        }],
    ]

    test.each(cases)('%s', (_, scenario) => {
        const result = check(scenario)
        expectExhaustive(result)
        expect(result.findings).toEqual([])
    })
})

describe('model check: the known gap', () => {
    // prior-art.md: "circular wait among agents that are all travelling the
    // same way, on a cycle with no spare capacity".  Locking the next node
    // does not close it: each agent claims its first node while entering,
    // before the other has moved.  These also show the checker finds
    // deadlocks when there are some.
    test('two agents swapping round a one-way 2-cycle deadlock', () => {
        const result = check({
            topology: { nodes: ['x', 'y'], links: [oneway('x', 'y'), oneway('y', 'x')] },
            agents: [
                { name: 'A', path: ['x', 'y'] },
                { name: 'B', path: ['y', 'x'] },
            ],
        })
        expectExhaustive(result)
        expect(result.findings).toContainEqual({
            kind: 'deadlock',
            message: 'A at x, B at y',
            trace: ['A enter', 'B enter', 'A move x', 'B move y'],
        })
    })

    test('three agents filling a one-way ring of three deadlock', () => {
        const result = check({
            topology: {
                nodes: ['a', 'b', 'c'],
                links: [oneway('a', 'b'), oneway('b', 'c'), oneway('c', 'a')],
            },
            agents: [
                { name: 'A', path: ['a', 'b', 'c'] },
                { name: 'B', path: ['b', 'c', 'a'] },
                { name: 'C', path: ['c', 'a', 'b'] },
            ],
        })
        expectExhaustive(result)
        expect(result.findings.some(f => f.kind === 'deadlock')).toBe(true)
        // never unsafe, only stuck
        expect(result.findings.filter(f => f.kind === 'violation')).toEqual([])
    })
})

describe('model check: setTopology against the gap', () => {
    // setTopology reserves through a pair of lock groups joined in both
    // directions, so it treats a 2-cycle like a corridor.  It only knows
    // pairs, and only declared groups: a longer one-way loop is not a pair.
    test('closes a one-way 2-cycle once its nodes are declared groups', () => {
        const result = check({
            topology: { nodes: ['x', 'y'], links: [oneway('x', 'y'), oneway('y', 'x')] },
            agents: [
                { name: 'A', path: ['x', 'y'] },
                { name: 'B', path: ['y', 'x'] },
            ],
            lockGroups: [['x'], ['y']],
            setTopology: true,
        })
        expectExhaustive(result)
        expect(result.findings).toEqual([])
    })

    test('leaves a one-way ring of three deadlocking', () => {
        const result = check({
            topology: {
                nodes: ['a', 'b', 'c'],
                links: [oneway('a', 'b'), oneway('b', 'c'), oneway('c', 'a')],
            },
            agents: [
                { name: 'A', path: ['a', 'b', 'c'] },
                { name: 'B', path: ['b', 'c', 'a'] },
                { name: 'C', path: ['c', 'a', 'b'] },
            ],
            lockGroups: [['a'], ['b'], ['c']],
            setTopology: true,
        })
        expectExhaustive(result)
        expect(result.findings.some(f => f.kind === 'deadlock')).toBe(true)
    })
})

describe('model check: loop capacity', () => {
    const ring = (n: number) => {
        const nodes = Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i))
        return { nodes, links: nodes.map((x, i) => oneway(x, nodes[(i + 1) % n])) }
    }

    // One agent per node of the ring, each going one or two steps round:
    // the known-gap schedules that fill it, now refused at entry.
    test.each([2, 3, 4])('a one-way ring of %i filled by as many agents no longer deadlocks', n => {
        const topology = ring(n)
        const agents = topology.nodes.map((x, i) => ({
            name: x.toUpperCase(),
            path: [x, topology.nodes[(i + 1) % n], ...(n > 2 ? [topology.nodes[(i + 2) % n]] : [])],
        }))
        const result = check({ topology, agents, loops: true })
        expectExhaustive(result)
        expect(result.findings).toEqual([])
    })

    // Parking spurs off a one-way loop of four; each robot starts in its own
    // spur and drives round to the next robot's.
    const spurs = () => {
        const loop = ['a', 'b', 'c', 'd']
        const topology = {
            nodes: [...loop, ...loop.map(n => 'P' + n)],
            links: [...loop.map((n, i) => oneway(n, loop[(i + 1) % 4])), ...loop.map(n => bi('P' + n, n))],
        }
        const route = (start: number, steps: number) => {
            const path = ['P' + loop[start]]
            for (let k = 0; k <= steps; k++) path.push(loop[(start + k) % 4])
            path.push('P' + loop[(start + steps) % 4])
            return path
        }
        return { topology, route }
    }

    test('four robots on parking spurs, two steps each, are clean', () => {
        const { topology, route } = spurs()
        const agents = [0, 1, 2, 3].map(i => ({ name: 'R' + i, path: route(i, 2) }))
        const result = check({ topology, agents, loops: true })
        expectExhaustive(result)
        expect(result.findings).toEqual([])
    })

    // The real gap.  Three steps each is a job set any controller could
    // finish, whether the robots start standing in their spurs or arrive
    // one at a time.  The loop still keeps its free node, but a robot
    // waiting in a spur to enter blocks the exit of one already on the loop:
    // that one cannot leave into the occupied spur, and the one in the spur
    // cannot enter the full loop.
    test('a spur occupied by a robot waiting to enter still blocks an exit', () => {
        const { topology, route } = spurs()
        const scenario = { topology, agents: [0, 1, 2, 3].map(i => ({ name: 'R' + i, path: route(i, 3) })), loops: true }
        expect(feasible(scenario, 'placed')).toBe(true)
        expect(feasible(scenario, 'arriving')).toBe(true)
        const result = check(scenario)
        expectExhaustive(result)
        expect(result.findings.some(f => f.kind === 'deadlock')).toBe(true)
    })
})

describe('model check: feasibility', () => {
    // feasible() knows nothing of locks, only that a node holds one robot.
    // Any rule only forbids some of its moves, so false means no controller
    // can finish the jobs.  It keeps impossible job sets from being mistaken
    // for locking bugs.
    const loop = ['a', 'b', 'c', 'd']
    const topology = {
        nodes: [...loop, ...loop.map(n => 'P' + n)],
        links: [...loop.map((n, i) => oneway(n, loop[(i + 1) % 4])), ...loop.map(n => bi('P' + n, n))],
    }
    const rotate = (steps: number) => [0, 1, 2, 3].map(i => {
        const path = ['P' + loop[i]]
        for (let k = 0; k <= steps; k++) path.push(loop[(i + k) % 4])
        return { name: 'R' + i, path: [...path, 'P' + loop[(i + steps) % 4]] }
    })

    test('four robots standing in full spurs cannot each move one along', () => {
        // every target is taken by a robot whose own target is taken; the
        // one spot that frees is reached through the node its taker blocks
        expect(feasible({ topology, agents: rotate(1) }, 'placed')).toBe(false)
        // arriving one at a time, the same jobs are easy: go one by one
        expect(feasible({ topology, agents: rotate(1) }, 'arriving')).toBe(true)
    })

    test('a one-way ring filled from the start cannot move at all', () => {
        const ring = { nodes: ['a', 'b', 'c'], links: [oneway('a', 'b'), oneway('b', 'c'), oneway('c', 'a')] }
        const agents = [
            { name: 'A', path: ['a', 'b', 'c'] },
            { name: 'B', path: ['b', 'c', 'a'] },
            { name: 'C', path: ['c', 'a', 'b'] },
        ]
        expect(feasible({ topology: ring, agents }, 'placed')).toBe(false)
        expect(feasible({ topology: ring, agents }, 'arriving')).toBe(true)
    })
})

describe('model check: what a stationary agent holds', () => {
    // Characterises today's rule, and changes when the rule does.  An agent
    // locks the node after the one it arrives at, even while it stands still
    // there working.  At a dead-end spur that next node is the lane, so the
    // lane is closed for as long as the work takes.
    test('a worker at a spur always holds the lane node too', () => {
        const scenario: Scenario = {
            topology: {
                nodes: ['p', 'L', 'q', 'S'],
                links: [oneway('p', 'L'), oneway('L', 'q'), bi('L', 'S')],
            },
            agents: [
                { name: 'W', path: ['p', 'L', 'S', 'L', 'q'] },
                { name: 'T', path: ['p', 'L', 'q'] },
            ],
        }
        let workerAtSpur = 0
        const result = check(scenario, state => {
            if (state.at('W') !== 'S') return undefined
            workerAtSpur++
            if (state.at('T') === 'L') return 'traffic on the lane while the worker is at the spur'
            const held = state.holds('W')
            return held.join() === 'L,S' ? undefined : `worker at spur holds ${held.join()}`
        })
        expectExhaustive(result)
        expect(workerAtSpur).toBeGreaterThan(0)
        expect(result.findings).toEqual([])
    })
})
