/* Node module hooks: `import 'three'` gives the real library with the GPU classes replaced by stand-ins. */
export async function resolve(specifier, context, next) {
  if (specifier === 'three' && context.parentURL && !context.parentURL.endsWith('three-stub.mjs')) {
    return { url: new URL('./three-stub.mjs', import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
