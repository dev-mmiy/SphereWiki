import { createFilePersistence } from "./file-persistence"
import { createSyncServer } from "./sync-server"

const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.SPHEREWIKI_DATA_DIR ?? ".spherewiki-data"

// Durable per-room persistence on the local filesystem (Cloud SQL/GCS slot in later).
const server = createSyncServer({ port, persistence: createFilePersistence(dataDir) })
await server.listen()
console.log(`[spherewiki] sync super-peer listening on ${server.webSocketURL} (data: ${dataDir})`)
