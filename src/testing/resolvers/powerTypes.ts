import { powerTypeV3 } from "../factories";

import type {
  ListPowerTypesError,
  ListPowerTypesResponse,
} from "@/app/apiclient";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockPowerTypes: ListPowerTypesResponse = {
  items: [
    powerTypeV3({
      name: "manual",
      description: "Manual",
      driver_type: "power",
    }),
    powerTypeV3({
      name: "amt",
      description: "Intel AMT",
      driver_type: "power",
    }),
    powerTypeV3({
      name: "apc",
      description:
        "American Power Conversion (APC) Power Distribution Unit (PDU)",
      driver_type: "power",
    }),
    powerTypeV3({
      name: "lxd",
      description: "LXD",
      driver_type: "power",
    }),
  ],
};

const mockListPowerTypesError: ListPowerTypesError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const powerTypesResolvers = {
  listPowerTypes: createResolver({
    method: "get",
    path: "power-types",
    data: mockPowerTypes,
    error: mockListPowerTypesError,
  }),
};

export { powerTypesResolvers, mockPowerTypes };
