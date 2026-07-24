// Bare /council is a client-side SPA route (the logged-in council page) —
// serve the shell here. /council/<slug> stays with [slug].js (SSR debates).
import { serveShell } from "../_shell.js";
export const onRequestGet = serveShell;
