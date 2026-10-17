// The shared `npm test` command runs test/*.test.ts. Importing the roof
// suite here runs it together with the secrets scan once both are present.
import '../server/middleware/roofAccess.test.ts';
