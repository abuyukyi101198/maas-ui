import type { GetSystemInfoError, SystemInfoResponse } from "@/app/apiclient";
import { systemInfo as systemInfoFactory } from "@/testing/factories";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockSystemInfo: SystemInfoResponse = systemInfoFactory();

const mockSystemInfoError: GetSystemInfoError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error",
};

const systemResolvers = {
  getSystemInfo: createResolver({
    method: "get",
    path: "system/info",
    data: mockSystemInfo,
    error: mockSystemInfoError,
  }),
};

export { systemResolvers, mockSystemInfo };
