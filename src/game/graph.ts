// Road-graph routing (Dijkstra and the guidance route). Only type imports from city.ts, so signs.ts and city.ts
// can both use it without a runtime cycle.
import type { City, Edge, Node } from "./city";
import * as C from "./constants";

export function dijkstra(
  nodes: Node[],
  edges: Edge[],
  src: number,
  cost: (e: Edge) => number = (e) => e.len,
): number[] {
  const dist = new Array(nodes.length).fill(Infinity);
  const done = new Array(nodes.length).fill(false);
  dist[src] = 0;
  for (let it = 0; it < nodes.length; it++) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!done[i] && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || dist[u] === Infinity) break;
    done[u] = true;
    for (const eid of nodes[u].edges) {
      const e = edges[eid];
      const v = e.a === u ? e.b : e.a;
      if (dist[u] + cost(e) < dist[v]) dist[v] = dist[u] + cost(e);
    }
  }
  return dist;
}

/**
 * Guidance cost: the river tunnel counts half, so routes take it (jam + ceiling lane) unless that is a >200 m
 * detour; east of it the y = 0 arterial (under the skyway, past ORBIT MART) is a touch cheaper than the equally long
 * grid alternatives, so every route stays on the corridor up to CORRIDOR_X1 before turning to the office row.
 */
function routeCost(city: City): (e: Edge) => number {
  return (e) => {
    const a = city.nodes[e.a],
      b = city.nodes[e.b];
    if (e.crossing && a.j === C.TUNNEL_ROW) return e.len * 0.5;
    if (
      e.axis === "x" &&
      a.j === C.TUNNEL_ROW &&
      Math.min(a.x, b.x) >= 0 &&
      Math.max(a.x, b.x) <= C.CORRIDOR_X1
    )
      return e.len * 0.98;
    return e.len;
  };
}

export function shortestPath(city: City, src: number, dst: number): Node[] {
  const cost = routeCost(city);
  const dist = dijkstra(city.nodes, city.edges, dst, cost);
  const path = [city.nodes[src]];
  let u = src;
  while (u !== dst) {
    let best = -1,
      bd = Infinity;
    for (const eid of city.nodes[u].edges) {
      const e = city.edges[eid];
      const v = e.a === u ? e.b : e.a;
      if (dist[v] + cost(e) < bd) {
        bd = dist[v] + cost(e);
        best = v;
      }
    }
    if (best < 0) break;
    u = best;
    path.push(city.nodes[u]);
  }
  return path;
}
