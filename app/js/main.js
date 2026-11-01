// Placeholder: proves the server, the contract and the kit import resolve. Lane C replaces it.
import "./kit/real.js";
const room = await fetch("/api/rooms/hoskins-living").then((r) => r.json());
const placed = await fetch("/api/place", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ roomId: room.id, piece: await fetch("/api/pieces/x").then((r) => r.json()) }) }).then((r) => r.json());
document.getElementById("out").textContent =
  `${room.name}: ${room.walls.length} walls, ${room.furniture.length} pieces of furniture.\nSofa: ${placed.say}`;
