import { fabricV3 } from "../factories/fabric";

import type { ListFabricsError, ListFabricsResponse } from "@/app/apiclient";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockFabrics: ListFabricsResponse = {
  items: fabricV3.buildList(5),
  total: 5,
};

const mockListFabricsError: ListFabricsError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const fabricsResolvers = {
  listFabrics: createResolver({
    method: "get",
    path: "fabrics",
    data: mockFabrics,
    error: mockListFabricsError,
  }),
};

export { fabricsResolvers, mockFabrics };
