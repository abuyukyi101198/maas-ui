import type {
  SetConfigurationError,
  GetConfigurationError,
  GetConfigurationsError,
  GetConfigurationsResponse,
} from "@/app/apiclient";
import { config as configFactory } from "@/testing/factories";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockConfigurations: GetConfigurationsResponse = {
  items: [configFactory()],
};

const mockGetConfigurationsError: GetConfigurationsError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const mockGetConfigurationError: GetConfigurationError = {
  message: "Configuration not found",
  code: 404,
  kind: "Error",
};

const mockSetConfigurationError: SetConfigurationError = {
  message: "Unprocessable entity",
  code: 422,
  kind: "Error",
};

const configurationsResolvers = {
  listConfigurations: createResolver({
    method: "get",
    path: "configurations",
    data: mockConfigurations,
    error: mockGetConfigurationsError,
  }),
  getConfiguration: createResolver({
    method: "get",
    path: "configurations/:id",
    data: mockConfigurations.items[0],
    error: mockGetConfigurationError,
  }),
  setConfiguration: createResolver({
    method: "put",
    path: "configurations/:id",
    data: configFactory(),
    error: mockSetConfigurationError,
  }),
  setBulkConfigurations: createResolver({
    method: "put",
    path: "configurations",
    // The success response on this endpoint is empty, according to the open API spec
    data: {},
    error: mockSetConfigurationError,
  }),
};

export { configurationsResolvers, mockConfigurations };
