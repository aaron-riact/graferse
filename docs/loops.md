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
the same as one bidirectional link. `findLoops` lists every simple loop,
which is exponential in the worst case; it is meant for site maps, run once.

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

`src/modelCheck.test.ts` pins this down, next to the cases the loop check
solves.
