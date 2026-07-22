/**
 * Re-exports the GitHub helpers so the dashboard doesn't reach across into
 * apps/api's internals.
 *
 * The implementations live in apps/api because that's where GitHub
 * credentials belong, but the setup flow is initiated from a browser session,
 * which only the dashboard has. Rather than proxying over HTTP for a
 * first-party call, the dashboard imports the same functions directly — both
 * apps already share the database and run in the same trust boundary.
 */
export {
  setupRepositoryWorkflow,
  listInstallationRepositories,
} from "../../../api/src/lib/github/setup";

export type { SetupResult } from "../../../api/src/lib/github/setup";
