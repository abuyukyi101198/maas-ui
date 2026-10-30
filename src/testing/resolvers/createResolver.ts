import type {
  DefaultBodyType,
  HttpHandler,
  HttpResponseResolver,
  PathParams,
} from "msw";
import { delay, http, HttpResponse } from "msw";

import { BASE_URL } from "@/testing/utils";

type Method = "get" | "post" | "put" | "patch" | "delete";

export type ResolverInfo = Parameters<
  HttpResponseResolver<PathParams, DefaultBodyType>
>[0];

type Reply = (info: ResolverInfo) => Response | Promise<Response>;

export type VariantOptions = {
  /** Only intercept requests matching this predicate; others pass through to the next handler. */
  when?: (info: ResolverInfo) => boolean;
};

type ResolverOptions<TData, TError> = {
  method: Method;
  /** Path relative to `MAAS/a/v3/`, e.g. `zones/:id` or `users/me:statistics`. */
  path: string;
  /** Default success payload passed to `handler()`. */
  data?: TData;
  /** Default error payload passed to `error()`; its `code` is the response status. */
  error: TError;
  /** Success status code; defaults to 200. */
  status?: number;
  /** Custom success response, e.g. looking up an item by path param. */
  respond?: (data: TData | undefined, info: ResolverInfo) => Response;
};

export type Resolver<TData, TError> = {
  /** Whether any variant of this resolver intercepted a request in the current test. */
  resolved: boolean;
  /** JSON body of the last intercepted request, or `null`. */
  body: unknown;
  /** Responds with `data`; pass a promise to hold the response until it settles. */
  handler: (
    data?: TData | Promise<TData>,
    options?: VariantOptions
  ) => HttpHandler;
  error: (error?: TError, options?: VariantOptions) => HttpHandler;
  /** Simulates a transport failure (connection refused/reset). */
  networkError: (options?: VariantOptions) => HttpHandler;
  /** Delays the success response; `"infinite"` leaves the request pending. */
  delayed: (
    ms: number | "infinite",
    data?: TData,
    options?: VariantOptions
  ) => HttpHandler;
  /** Responds with a non-JSON body, e.g. a proxy error page. */
  malformed: (status?: number, options?: VariantOptions) => HttpHandler;
};

const registry = new Set<Resolver<unknown, unknown>>();

/** Clears call tracking on every resolver; run before each test by `setupMockServer`. */
export const resetResolvers = (): void => {
  registry.forEach((resolver) => {
    resolver.resolved = false;
    resolver.body = null;
  });
};

export const notFound = (): Response =>
  HttpResponse.json(
    { message: "Not found", code: 404, kind: "Error" },
    { status: 404 }
  );

export const createResolver = <TData, TError extends { code?: number }>({
  method,
  path,
  data: defaultData,
  error: defaultError,
  status,
  respond,
}: ResolverOptions<TData, TError>): Resolver<TData, TError> => {
  // A `:` that does not start a path segment is a literal action separator
  // (e.g. `zones:statistics`), not a path parameter, so escape it for MSW.
  const url = `${BASE_URL}MAAS/a/v3/${path.replace(/([^/]):/g, "$1\\:")}`;

  const intercept = (reply: Reply, { when }: VariantOptions = {}) =>
    http[method](url, async (info) => {
      if (when && !when(info)) {
        return undefined;
      }
      resolver.resolved = true;
      if (
        info.request.headers.get("content-type")?.includes("application/json")
      ) {
        resolver.body = await info.request.clone().json();
      }
      return reply(info);
    });

  const succeed =
    (data: TData | Promise<TData> | undefined): Reply =>
    async (info) => {
      const settled = await data;
      return respond
        ? respond(settled, info)
        : HttpResponse.json(settled as DefaultBodyType, { status });
    };

  const resolver: Resolver<TData, TError> = {
    resolved: false,
    body: null,
    handler: (data = defaultData, options) => intercept(succeed(data), options),
    error: (error = defaultError, options) =>
      intercept(
        () => HttpResponse.json(error, { status: error.code }),
        options
      ),
    networkError: (options) => intercept(() => HttpResponse.error(), options),
    delayed: (ms, data = defaultData, options) =>
      intercept(async (info) => {
        await delay(ms);
        return succeed(data)(info);
      }, options),
    malformed: (malformedStatus = 502, options) =>
      intercept(
        () =>
          new HttpResponse("<html><body>Bad Gateway</body></html>", {
            status: malformedStatus,
            headers: { "Content-Type": "text/html" },
          }),
        options
      ),
  };

  registry.add(resolver as Resolver<unknown, unknown>);
  return resolver;
};
