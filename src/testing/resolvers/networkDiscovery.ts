import type {
  GetDiscoveryError,
  ListDiscoveriesError,
  ListDiscoveriesResponse,
} from "@/app/apiclient";
import { discovery as discoveryFactory } from "@/testing/factories";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockNetworkDiscoveries: ListDiscoveriesResponse = {
  items: [discoveryFactory(), discoveryFactory(), discoveryFactory()],
  total: 3,
};

const mockListDiscoveriesError: ListDiscoveriesError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // This will always be 'Error' for every error response
};

const mockGetDiscoveriesError: GetDiscoveryError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const networkDiscoveryResolvers = {
  listNetworkDiscoveries: createResolver({
    method: "get",
    path: "discoveries",
    data: mockNetworkDiscoveries,
    error: mockListDiscoveriesError,
  }),
  clearNetworkDiscoveries: createResolver({
    method: "delete",
    path: "discoveries",
    data: {},
    status: 204,
    error: mockGetDiscoveriesError,
  }),
};

export { networkDiscoveryResolvers, mockNetworkDiscoveries };
