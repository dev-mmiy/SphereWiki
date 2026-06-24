import { createSyncServer } from "./sync-server"

const port = Number(process.env.PORT ?? 8787)
const server = createSyncServer({ port })
await server.listen()
console.log(`[spherewiki] sync super-peer listening on ${server.webSocketURL}`)
