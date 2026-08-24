import type { AuthenticatedUser } from './authenticated-user.type';

// Passport (via @types/passport) declares `Express.Request.user` typed as
// `Express.User` — augmenting that interface (rather than Request directly)
// is what actually flows our JwtStrategy return type through to req.user.
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration merging, not a bare alias
    interface User extends AuthenticatedUser {}
  }
}
