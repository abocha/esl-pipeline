# Extended Route Modules

`registerExtendedRoutes` composes these modules in deterministic order:

1. `config-routes.ts`
2. `students-routes.ts`
3. `profiles-templates-routes.ts`
4. `recordings-routes.ts`
5. `auth-user-routes.ts`
6. `ops-routes.ts`

Ownership guidelines:

- Keep route paths, auth guards, and response contracts behaviorally identical unless a feature change explicitly requires otherwise.
- Place shared context/types in `context.ts`.
- Keep provider-cache fingerprint logic in `recording-provider-cache.ts` (also re-exported by `transport/extended-routes.ts` for tests).
- Prefer adding new handlers in the closest domain module instead of growing cross-domain helpers.
