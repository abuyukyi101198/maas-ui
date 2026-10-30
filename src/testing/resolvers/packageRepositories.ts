import { HttpResponse } from "msw";

import type {
  CreatePackageRepositoryError,
  DeletePackageRepositoryError,
  GetPackageRepositoryError,
  GetPackageRepositoryResponse,
  ListPackageRepositoriesError,
  ListPackageRepositoriesResponse,
  UpdatePackageRepositoryError,
} from "@/app/apiclient";
import { packageRepository as packageRepositoryFactory } from "@/testing/factories";
import { createResolver, notFound } from "@/testing/resolvers/createResolver";

const mockPackageRepositories: ListPackageRepositoriesResponse = {
  items: [
    packageRepositoryFactory({ id: 1 }),
    packageRepositoryFactory({ id: 2 }),
    packageRepositoryFactory({ id: 3 }),
  ],
  total: 3,
};

const mockPackageRepositoriesError: ListPackageRepositoriesError = {
  code: 500,
  message: "Internal Server Error",
  kind: "Error", // This will always be 'Error' for every error response
};

const mockGetPackageRepoError: GetPackageRepositoryError = {
  code: 404,
  message: "Repository not found",
  kind: "Error",
};

const mockCreatePackageRepoError: CreatePackageRepositoryError = {
  code: 409,
  message: "Conflicting resource",
  kind: "Error",
};

const mockUpdatePackageRepoError: UpdatePackageRepositoryError = {
  code: 422,
  message: "Unprocessable entity",
  kind: "Error",
};

const mockDeletePackageRepoError: DeletePackageRepositoryError = {
  code: 404,
  message: "Repository not found",
  kind: "Error",
};

const packageRepositoriesResolvers = {
  listPackageRepositories: createResolver({
    method: "get",
    path: "package_repositories",
    data: mockPackageRepositories,
    error: mockPackageRepositoriesError,
  }),
  getPackageRepository: createResolver({
    method: "get",
    path: "package_repositories/:id",
    error: mockGetPackageRepoError,
    respond: (data: GetPackageRepositoryResponse | undefined, { params }) => {
      const packageRepository =
        data ??
        mockPackageRepositories.items.find(
          (packageRepository) => packageRepository.id === Number(params.id)
        );
      return packageRepository
        ? HttpResponse.json(packageRepository)
        : notFound();
    },
  }),
  createPackageRepository: createResolver({
    method: "post",
    path: "package_repositories",
    data: { id: 1 },
    error: mockCreatePackageRepoError,
  }),
  updatePackageRepository: createResolver({
    method: "put",
    path: "package_repositories/:id",
    data: { id: 1 },
    error: mockUpdatePackageRepoError,
  }),
  deletePackageRepository: createResolver({
    method: "delete",
    path: "package_repositories/:id",
    data: {},
    status: 204,
    error: mockDeletePackageRepoError,
  }),
};

export { packageRepositoriesResolvers, mockPackageRepositories };
