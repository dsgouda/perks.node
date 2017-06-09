require("../async-iterator")
require("../bluebird-stacktraces")
require("../async-awaiter")

export const polyfilled = true
export * from './lib/exception'
export * from './lib/outstanding-task-awaiter'


/** 
 * Creates a shallow copy of a given object by copying the properties to a new object
 * Note: this does not copy the method prototypes, so it's a shallow data copy only.
 * 
 * @param {input} any javascript object 
 * @param {filter} Array<string> of properties to filter out from the copy.
 */
export function shallowCopy(input: any, ...filter: Array<string>): any {
  if (!input) {
    return input;
  }
  const keys = input.Keys ? input.Keys : Object.getOwnPropertyNames(input);

  const result: any = {};
  for (const key of keys) {
    if (filter.indexOf(key) == -1) {
      const value = input[key];
      if (value !== undefined) {
        result[key] = value;
      }
    }
  }
  return result;
}
