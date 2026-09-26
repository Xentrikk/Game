import { deleteE2eUsers } from "./helpers";

export default async function globalSetup() {
  await deleteE2eUsers();
}
