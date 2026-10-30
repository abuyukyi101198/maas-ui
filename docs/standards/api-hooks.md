# API Query and Mutation Hooks Standards

## TL;DR

- Auto-generated SDK lives in `src/app/apiclient` — do not edit it by hand
- `import type` from `@/app/apiclient` is allowed anywhere for TypeScript types; query key helpers from `@/app/apiclient/@tanstack/react-query.gen` are allowed for cache invalidation; all other value imports from `apiclient` in component files are banned — use hooks in `src/app/api/query/` instead
- Manually write hooks in `src/app/api/query/` using the generated react-query.ts hooks
- Use `useWebsocketAwareQuery` with `queryOptionsWithHeaders` for queries to auto-invalidate on websocket updates and include response headers
- Use `useMutation` with `mutationOptionsWithHeaders` and `invalidateQueries` in `onSuccess` for mutations
- Create mock resolvers in `src/testing/resolvers/` using MSW (Mock Service Worker)
- Test hooks using `renderHookWithProviders` and mock resolvers
- Follow naming convention: `use<ResourcePlural>` for list queries, `useGet<Resource>` for single-item queries, `use<Action><Resource>` for single-resource mutations, `use<Action><ResourcePlural>` or `useBulk<Action><Resource>` for bulk mutations

## Naming Conventions

| Hook type | Pattern | Example |
|---|---|---|
| List query | `use<ResourcePlural>` | `usePools`, `useUsers` |
| Single item query | `useGet<Resource>` | `useGetPool`, `useGetUser` |
| Derived query (via `select`) | `use<Resource><Derivation>` | `usePoolCount` |
| Create mutation | `useCreate<Resource>` | `useCreatePool` |
| Update mutation | `useUpdate<Resource>` | `useUpdatePool` |
| Delete mutation | `useDelete<Resource>` | `useDeletePool` |
| Bulk mutation (plural resource) | `use<Action><ResourcePlural>` | `useCreateSshKeys`, `useDeleteCustomImages` |
| Bulk mutation (explicit prefix) | `useBulk<Action><Resource>` | `useBulkSetConfigurations` |

Queries that use `select` to derive data from a list query should be named `use<Resource><Derivation>` — not `useGet*`. `useGet*` is reserved for single-item queries that fetch by ID.

## Overview

Our API layer follows a three-tier architecture:

1. **Auto-generated SDK** (`src/app/apiclient`) - Generated from OpenAPI spec. Two things from this layer are allowed in component files: `import type` (TypeScript types only) and query key helpers from `@/app/apiclient/@tanstack/react-query.gen` (e.g. `listDiscoveriesQueryKey`) used for cache invalidation in `onSuccess`. All other value imports from `apiclient` in component files are banned — go through the custom hooks layer instead.
2. **Custom hooks** (`src/app/api/query/`) - Manually written React Query hooks. This is the only layer components should import values from.
3. **Mock resolvers** (`src/testing/resolvers/`) - MSW handlers for testing

## Writing Query Hooks

### Basic List Query

Use `useWebsocketAwareQuery` with `queryOptionsWithHeaders` to automatically invalidate when websocket updates occur and include response headers:

```typescript
export const useUsers = (options?: Options<ListUsersWithSummaryData>) => {
  return useWebsocketAwareQuery(
    queryOptionsWithHeaders<
      ListUsersWithSummaryResponses,
      ListUsersWithSummaryErrors,
      ListUsersWithSummaryData
    >(options, listUsersWithSummary, listUsersWithSummaryQueryKey(options))
  );
};
```

### Single Item Query

```typescript
export const useGetUser = (options: Options<GetUserData>) => {
  return useWebsocketAwareQuery(
    queryOptionsWithHeaders<GetUserResponses, GetUserErrors, GetUserData>(
      options,
      getUser,
      getUserQueryKey(options)
    )
  );
};
```

### Derived Queries

For queries that transform data, use the `select` option:

```typescript
export const useUserCount = (options?: Options<ListUsersWithSummaryData>) => {
  return useWebsocketAwareQuery({
    ...queryOptionsWithHeaders<
      ListUsersWithSummaryResponses,
      ListUsersWithSummaryErrors,
      ListUsersWithSummaryData
    >(options, listUsersWithSummary, listUsersWithSummaryQueryKey(options)),
    select: (data) => data?.total ?? 0,
  });
};
```

## Writing Mutation Hooks

### Basic Mutation

Always invalidate related queries in `onSuccess`. Use `mutationOptionsWithHeaders` to include response headers:

```typescript
export const useCreateUser = (mutationOptions?: Options<CreateUserData>) => {
  const queryClient = useQueryClient();
  return useMutation({
    ...mutationOptionsWithHeaders<
      CreateUserResponses,
      CreateUserErrors,
      CreateUserData
    >(mutationOptions, createUser),
    onSuccess: () => {
      return queryClient.invalidateQueries({
        queryKey: listUsersWithSummaryQueryKey(),
      });
    },
  });
};
```

### Update Mutation

```typescript
export const useUpdateUser = (mutationOptions?: Options<UpdateUserData>) => {
  const queryClient = useQueryClient();
  return useMutation({
    ...mutationOptionsWithHeaders<
      UpdateUserResponses,
      UpdateUserErrors,
      UpdateUserData
    >(mutationOptions, updateUser),
    onSuccess: () => {
      return queryClient.invalidateQueries({
        queryKey: listUsersWithSummaryQueryKey(),
      });
    },
  });
};
```

### Delete Mutation

```typescript
export const useDeleteUser = (mutationOptions?: Options<DeleteUserData>) => {
  const queryClient = useQueryClient();
  return useMutation({
    ...mutationOptionsWithHeaders<
      DeleteUserResponses,
      DeleteUserErrors,
      DeleteUserData
    >(mutationOptions, deleteUser),
    onSuccess: () => {
      return queryClient.invalidateQueries({
        queryKey: listUsersWithSummaryQueryKey(),
      });
    },
  });
};
```

## WebSocket-Aware Queries

`useWebsocketAwareQuery` wraps `useQuery` with two additional behaviours:

1. **WebSocket NOTIFY invalidation** — when the WebSocket sends a NOTIFY message for a model that maps to this query's key, the query is automatically invalidated and refetched.
2. **Reconnect invalidation** — when the WebSocket reconnects (tracked via `connectedCount` from Redux status selectors), the query is invalidated so stale data is not shown.

Always use `useWebsocketAwareQuery` with `queryOptionsWithHeaders` for all queries. Never use bare `useQuery`.

```typescript
export const usePools = (
  options?: Options<ListResourcePoolsStatisticsData>
) => {
  return useWebsocketAwareQuery(
    queryOptionsWithHeaders<
      ListResourcePoolsStatisticsResponses,
      ListResourcePoolsStatisticsErrors,
      ListResourcePoolsStatisticsData
    >(
      options,
      listResourcePoolsStatistics,
      listResourcePoolsStatisticsQueryKey(options)
    )
  );
};
```

### Adding Real-Time Updates for a New Resource

The model-to-query-key mapping lives in `wsToQueryKeyMapping` in `src/app/api/query/base.ts`. To wire up WebSocket invalidation for a new resource, add its mapping there:

```typescript
const wsToQueryKeyMapping: Partial<Record<WebSocketEndpointModel, unknown>> = {
  zone: listZonesWithStatisticsQueryKey(),
  sshkey: listUserSshkeysQueryKey(),
};
```

Add an entry using the `WebSocketEndpointModel` value for the resource and the corresponding generated query key function called with no arguments.

## Writing Mock Resolvers

Mock resolvers use [MSW (Mock Service Worker)](https://mswjs.io/) to intercept HTTP requests during testing. Create a resolver file in `src/testing/resolvers/` for each resource and build every operation with `createResolver` from `src/testing/resolvers/createResolver.ts`.

### Resolver Structure

Each resolver file should follow this structure:

1. **Mock data constants** - Default response data using factories
2. **Error constants** - Default error responses for each operation
3. **Resolver object** - One `createResolver(...)` per endpoint operation
4. **Exports** - Export both the resolvers and mock data

### Key Principles

- **Declare the endpoint once**: `method` and `path` (relative to `MAAS/a/v3/`) are given once; every variant is generated from them. Write action separators raw (`zones:statistics`, `selections/:id:sync`) — a `:` that does not start a path segment is escaped automatically.
- **Overridable responses**: `handler(data?)` and `error(error?)` default to the `data` and `error` options. The error's `code` is the response status.
- **Custom logic only via `respond`**: use `respond(data, info)` when the success response depends on the request (by-id lookup, pagination). Return `notFound()` for a missing item — never `HttpResponse.error()`, which simulates a network failure.
- **Call tracking is automatic**: every resolver exposes `resolved` (intercepted a request) and `body` (JSON body of the last request). `setupMockServer` resets both before each test.
- **Use factories**: Generate mock data using factory functions for consistency

### Complete Example

```typescript
// 1. Define default mock data using factories
const mockUsers: ListUsersResponse = {
  items: [
    userFactory({ id: 1, email: "user1@example.com", username: "user1" }),
    userFactory({ id: 2, email: "user2@example.com", username: "user2" }),
  ],
  total: 2,
};

// 2. Define default error responses
const mockListUsersError: ListUsersError = {
  message: "Unauthorized",
  code: 401,
  kind: "Error", // Always "Error" for error responses
};

const mockGetUserError: GetUserError = {
  message: "Not found",
  code: 404,
  kind: "Error",
};

// 3. Create the resolver object
const usersResolvers = {
  listUsers: createResolver({
    method: "get",
    path: "users",
    data: mockUsers,
    error: mockListUsersError,
  }),
  getUser: createResolver({
    method: "get",
    path: "users/:id",
    error: mockGetUserError,
    // Return the override if given, otherwise look the item up by id
    respond: (data: UserResponse | undefined, { params }) => {
      const user =
        data ?? mockUsers.items.find((user) => user.id === Number(params.id));
      return user ? HttpResponse.json(user) : notFound();
    },
  }),
  deleteUser: createResolver({
    method: "delete",
    path: "users/:id",
    data: {},
    status: 204,
    error: mockGetUserError,
  }),
};

// 4. Export both resolvers and mock data for reuse in tests
export { usersResolvers, mockUsers };
```

### Using Resolvers in Tests

**Override default response data:**

```typescript
// Return empty list
mockServer.use(usersResolvers.listUsers.handler({ items: [], total: 0 }));

// Return specific data
mockServer.use(
  usersResolvers.listUsers.handler({
    items: [userFactory({ id: 999, username: "special-user" })],
    total: 1,
  })
);
```

**Override default errors:**

```typescript
// Custom error message
mockServer.use(
  usersResolvers.createUser.error({
    message: "Custom error message",
    code: 500,
    kind: "Error",
  })
);

// Use default error
mockServer.use(usersResolvers.createUser.error());
```

**Inject transport faults:**

```typescript
// Connection failure (no HTTP response)
mockServer.use(usersResolvers.listUsers.networkError());

// Slow response; "infinite" keeps the request pending
mockServer.use(usersResolvers.listUsers.delayed(2000));

// Non-JSON body, e.g. a proxy error page (status defaults to 502)
mockServer.use(usersResolvers.listUsers.malformed());
```

**Target specific requests:** every variant accepts `{ when }` as its last argument; non-matching requests fall through to the next handler.

```typescript
mockServer.use(
  usersResolvers.listUsers.error(undefined, {
    when: ({ request }) =>
      new URL(request.url).searchParams.get("page") === "2",
  })
);
```

**Check if resolver was called, and with what body:**

```typescript
await userEvent.click(screen.getByRole("button", { name: /save/i }));

await waitFor(() => {
  expect(usersResolvers.updateUser.resolved).toBeTruthy();
});
expect(usersResolvers.updateUser.body).toMatchObject({ username: "new" });
```

## Testing Hooks

### Test Structure

```typescript
const mockServer = setupMockServer(
  usersResolvers.listUsers.handler(),
  usersResolvers.createUser.handler()
);

describe("useUsers", () => {
  it("should return users data", async () => {
    const { result } = renderHookWithProviders(() => useUsers());
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(mockUsers);
  });

  it("should handle empty list", async () => {
    mockServer.use(usersResolvers.listUsers.handler({ items: [], total: 0 }));
    const { result } = renderHookWithProviders(() => useUsers());
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data?.items).toHaveLength(0);
  });

  it("should handle errors", async () => {
    mockServer.use(usersResolvers.listUsers.error());
    const { result } = renderHookWithProviders(() => useUsers());
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
```

### Testing Mutations

```typescript
describe("useCreateUser", () => {
  it("should create a new user", async () => {
    const newUser = {
      email: "new@example.com",
      username: "newuser",
      password: "password",
    };
    const { result } = renderHookWithProviders(() => useCreateUser());
    result.current.mutate({ body: newUser });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
  });

  it("should handle creation errors", async () => {
    mockServer.use(
      usersResolvers.createUser.error({
        message: "User already exists",
        code: 409,
        kind: "Error",
      })
    );
    const { result } = renderHookWithProviders(() => useCreateUser());
    result.current.mutate({ body: { username: "test" } });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error?.message).toBe("User already exists");
  });
});
```

### Testing Single Item Queries

```typescript
describe("useGetUser", () => {
  it("should return the correct user", async () => {
    const expectedUser = mockUsers.items[0];
    const { result } = renderHookWithProviders(() =>
      useGetUser({ path: { user_id: expectedUser.id } })
    );
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(expectedUser);
  });

  it("should return error if user does not exist", async () => {
    const { result } = renderHookWithProviders(() =>
      useGetUser({ path: { user_id: 999 } })
    );
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
  });
});
```

## Best Practices

1. **Naming Conventions**:

   - List queries: `use<ResourcePlural>` (e.g., `useUsers`, `usePools`)
   - Single item: `useGet<Resource>` (e.g., `useGetUser`, `useGetPool`)
   - Mutations: `use<Mutation><Resource>` (e.g., `useCreate<Resource>`, `useUpdate<Resource>`, `useDelete<Resource>`)
   - Derivations: `use<Resource><Derivation>` (e.g., `use<Resource>Count`)

2. **Query Invalidation**:

   - Always invalidate related queries after mutations
   - Use `invalidateQueries` with the appropriate query key from the generated SDK

3. **WebSocket Awareness**:

   - Use `useWebsocketAwareQuery` with `queryOptionsWithHeaders` for all queries to automatically invalidate on real-time updates
   - Map websocket models to query keys in `base.ts` if needed

4. **Type Safety**:

   - Always use the generated types from `@/app/apiclient`
   - Use `queryOptionsWithHeaders` and `mutationOptionsWithHeaders` with proper type parameters for automatic type inference
   - Type parameters follow the pattern: `<Responses, Errors, Data>`

5. **Error Handling**:

   - All error types have `message`, `code`, and `kind` fields
   - Use the `errors` prop on forms to display mutation errors

6. **Testing**:

   - Use `setupMockServer` to configure MSW handlers
   - Use `renderHookWithProviders` to test hooks with React Query context
   - Test success, error, and edge cases for all hooks
   - Use `waitFor` to wait for async operations

7. **Mock Data**:
   - Export mock data from resolver files for reuse in tests
   - Use factories to generate test data
   - Provide both success and error handlers for all endpoints

## Common Pitfalls

- **Don't** forget to invalidate queries after mutations - stale data is confusing for users
- **Don't** use `useQuery` directly - always use `useWebsocketAwareQuery` with `queryOptionsWithHeaders` for queries
- **Don't** use `useMutation` directly without `mutationOptionsWithHeaders` - you'll miss response headers
- **Don't** forget to export mock data from resolver files
- **Don't** forget to set `resolved` flag in resolvers - it's useful for testing
- **Don't** forget to handle empty states in tests
- **Don't** forget to provide all three type parameters (`Responses`, `Errors`, `Data`) to the utility functions

### Query Key Scoping in invalidateQueries

Always call the query key function with no arguments in `invalidateQueries` to invalidate the full list. Passing `options` only invalidates the specific page or filter combination, leaving other cached pages stale.

**Do** — invalidates every cached result for that resource:

```typescript
onSuccess: () => {
  return queryClient.invalidateQueries({
    queryKey: listResourcePoolsStatisticsQueryKey(),
  });
},
```

**Don't** — scopes invalidation to the exact query key matching `options`, leaving other cached pages stale:

```typescript
onSuccess: () => {
  return queryClient.invalidateQueries({
    queryKey: listResourcePoolsStatisticsQueryKey(options),
  });
},
```
