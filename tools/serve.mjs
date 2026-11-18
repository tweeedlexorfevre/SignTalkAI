// Serves the built app (web/dist) together with the messenger API, the
// WebSocket hub. Loopback only unless HOST is set.
// Needs the root dependencies: run `npm install` in the project root once.
import { startServer } from '../server/app.mjs';
startServer();
