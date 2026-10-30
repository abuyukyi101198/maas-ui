import type { SyncBootsourceBootsourceselectionError } from "@/app/apiclient";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockSyncError: SyncBootsourceBootsourceselectionError = {
  message: "Conflict",
  code: 409,
  kind: "Error",
};

const imageSyncResolvers = {
  startSynchronization: createResolver({
    method: "post",
    path: "boot_sources/:boot_source_id/selections/:id:sync",
    data: {},
    status: 202,
    error: mockSyncError,
  }),
  stopSynchronization: createResolver({
    method: "post",
    path: "boot_sources/:boot_source_id/selections/:id:stop_sync",
    data: {},
    error: mockSyncError,
  }),
};

export { imageSyncResolvers };
