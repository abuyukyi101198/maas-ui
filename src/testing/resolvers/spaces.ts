import { spaceV3 } from "../factories/space";

import type { ListSpacesError, ListSpacesResponse } from "@/app/apiclient";
import { createResolver } from "@/testing/resolvers/createResolver";

const mockSpaces: ListSpacesResponse = {
  items: spaceV3.buildList(5),
  total: 5,
};

const mockListSpacesError: ListSpacesError = {
  message: "Internal server error",
  code: 500,
  kind: "Error",
};

const spacesResolvers = {
  listSpaces: createResolver({
    method: "get",
    path: "spaces",
    data: mockSpaces,
    error: mockListSpacesError,
  }),
};

export { mockSpaces, spacesResolvers };
