# One-way loops

A one-way link is a safe place to stop: nobody can come towards you on it.
So the reservation walk stops looking once it reaches one. That is true of
a single link, and false of a loop of them. On a loop, every agent can end
up waiting on the agent in front:

```
            x ─────────► y
            ▲            │
            └────────────┘

   A enters at x, wants y.   B enters at y, wants x.
```

Once both are on, no order of moves gets them out. The same holds for a
ring of three with three agents, or of N with N. It is circular wait with
no spare node, and the only place to prevent it is at entry.

## Declaring loops

Hand Graferse the loops, and a loop of N nodes admits at most N - 1 agents:

```js
const loops = creator.findLoops(onewayEdges)   // [[x, y], ...]
creator.setLoops(loops)
```

Pass the one-way links only. A bidirectional link is guarded by direction
claims already, and from an edge list alone a pair of one-way links looks
the same as one bidirectional link. `findLoops` lists every simple loop with
Johnson's algorithm: loops only exist inside strongly connected parts, so a
map with many paths but few loops stays fast.

An agent on a loop moves round it freely. An agent about to take its first
node on a loop is admitted only while fewer than N - 1 others hold nodes on
it. Refused, it stops before the loop and waits on every node of it, so any
of them coming free replays it.

Graferse still never holds your graph. Without `setLoops` nothing changes.

## Blocked exits, and the fleet limit that prevents them

Run no more agents than the smallest one-way loop's N - 1, and no loop can
deadlock, `setLoops` or not: once a loop is at its limit, every agent is
on it and none is waiting to get on. `shortestLoop(onewayEdges)` finds that
loop, and so the limit for the whole map, without listing every loop.
In every case the model checker walks, N - 1 agents never deadlock; that is
evidence for these cases, not a proof for every route.

`setLoops` is for running more agents than that, and it has a limit of its
own. It keeps a free node on every declared loop, but it cannot keep the
loop's exits clear. Hang a dead-end spur off each node of a four-loop, and
send four robots round from spur to spur, three steps each. Three get onto
the loop. The fourth waits in its spur, which is exactly where one on the
loop wants to leave it, and the run into a dead end is refused while it is
occupied. The one on the loop cannot leave, the one in the spur cannot
enter, and the loop is stuck.

These jobs can be finished: `feasible()` in `src/modelCheck.ts` knows
nothing of locks, only that a node holds one robot, and finds a way through
whether the robots start standing in their spurs or arrive one at a time.
So beyond the fleet limit, this is a gap in the rules, not an impossible
job set.

Reserving each agent's exit before it joins a loop closes that case and
opens another: two agents that swap spurs then wait for each other before
either gets on, where without the rule one would use the loop to wait in.
Tried, model-checked, and not adopted. Beating both needs look-ahead, the
banker's check `prior-art.md` mentions.

Some job sets are impossible, and no rule can help them. Four robots
standing in four full spurs cannot each move one spur along, and a one-way
ring filled from the start cannot move at all. `feasible()` tells those
apart from gaps in the rules, and `src/modelCheck.test.ts` pins down both.
