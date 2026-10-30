import { HttpResponse } from "msw";

import { imageSourceFactory } from "../factories";

import type {
  BootSourceResponse,
  BootSourcesListResponse,
  GetBootsourceError,
  ListBootsourcesError,
  UpdateBootsourceError,
} from "@/app/apiclient";
import { createResolver, notFound } from "@/testing/resolvers/createResolver";

const mockImageSources: BootSourcesListResponse = {
  items: [
    imageSourceFactory.build({
      id: 1,
      url: "http://images.maas.io/ephemeral-v3/stable/",
      keyring_filename: "/usr/share/keyrings/ubuntu-cloudimage-keyring.gpg",
      keyring_data: "aabbccdd",
      priority: 0,
      skip_keyring_verification: false,
    }),
  ],
  total: 1,
};

const mockListImageSourcesError: ListBootsourcesError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error",
};

const mockGetImageSourceError: GetBootsourceError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

const mockUpdateImageSourceError: UpdateBootsourceError = {
  message: "Bad request",
  code: 400,
  kind: "Error",
};

const imageSourceResolvers = {
  listImageSources: createResolver({
    method: "get",
    path: "boot_sources",
    data: mockImageSources,
    error: mockListImageSourcesError,
  }),
  getImageSource: createResolver({
    method: "get",
    path: "boot_sources/:id",
    error: mockGetImageSourceError,
    respond: (data: BootSourceResponse | undefined, { params }) => {
      const imageSource =
        data ??
        mockImageSources.items.find(
          (source) => source.id === Number(params.id)
        );
      return imageSource ? HttpResponse.json(imageSource) : notFound();
    },
  }),
  fetchImageSource: createResolver({
    method: "post",
    path: "boot_sources:fetch",
    data: {},
    error: mockUpdateImageSourceError,
  }),
  createImageSource: createResolver({
    method: "post",
    path: "boot_sources",
    data: {},
    status: 201,
    error: mockUpdateImageSourceError,
  }),
  updateImageSource: createResolver({
    method: "put",
    path: "boot_sources/:id",
    data: {},
    error: mockUpdateImageSourceError,
  }),
  deleteImageSource: createResolver({
    method: "delete",
    path: "boot_sources/:id",
    data: {},
    status: 204,
    error: mockUpdateImageSourceError,
  }),
};

export { imageSourceResolvers, mockImageSources };
