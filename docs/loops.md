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

## Not yet covered

The loop keeps a free node, but its exits can still be blocked. Hang a
dead-end spur off each node of a four-loop, and send four robots round from
spur to spur, three steps each. Three get onto the loop. The fourth waits in
its spur, which is exactly where one on the loop wants to leave it, and the
run into a dead end is refused while it is occupied. The one on the loop
cannot leave, the one in the spur cannot enter, and the loop is stuck.

These jobs can be finished: `feasible()` in `src/modelCheck.ts` knows
nothing of locks, only that a node holds one robot, and finds a way through
whether the robots start standing in their spurs or arrive one at a time.
So this is a gap in the rules, not an impossible job set.

Some job sets are impossible, and no rule can help them. Four robots
standing in four full spurs cannot each move one spur along, and a one-way
ring filled from the start cannot move at all. `feasible()` tells the two
apart, and `src/modelCheck.test.ts` pins down both.

With no more robots than the loop's N - 1, the gap cannot arise: once the
loop is at its limit, every robot is on it and none is waiting in a spur.
`shortestLoop(onewayEdges)` finds the smallest loop, which sets that limit
for the whole map, without listing every loop.
