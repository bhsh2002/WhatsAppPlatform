import picomatch from './posix.cjs';
export default picomatch;
export const { scan, parse, makeRe, compileRe, toRegex, test, matchBase, isMatch, constants } = picomatch;
