// Oxlint JS plugin (ESLint v9 rule API): syntactic checks for Effect v4 code.
// Each rule is high precision on purpose; anything that needs types is left to @effect/tsgo.
// meta.docs.standard is the rule file (id, revision, scope, example, calibration) relative to the skill.
// Bump `revision` when a rule's meaning changes, and change its fixtures and rule file in the same commit.

const REF = "see effect-ts/references"

const meta = (name, revision, type) => ({
  type,
  docs: { id: `effect-skill/${name}`, revision, standard: `scripts/rules/${name}.md` }
})

const isMember = (node, object, properties) =>
  node?.type === "MemberExpression" &&
  !node.computed &&
  node.object.type === "Identifier" &&
  node.object.name === object &&
  node.property.type === "Identifier" &&
  properties.includes(node.property.name)

const isFunction = (node) =>
  node.type === "FunctionExpression" ||
  node.type === "ArrowFunctionExpression" ||
  node.type === "FunctionDeclaration"

const enclosingFunction = (node) => {
  let current = node.parent
  while (current && !isFunction(current)) current = current.parent
  return current
}

const stringValue = (node) => {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked
  return undefined
}

const isNumber = (node) => node?.type === "Literal" && typeof node.value === "number" && node.value !== 0

const propertyNamed = (property, name) =>
  property.type === "Property" && !property.computed && property.key.type === "Identifier" && property.key.name === name

// function* passed to Effect.gen(...), Effect.fn(...), Effect.fnUntraced(...) or Effect.fn("name")(...)
const isEffectGenerator = (fn) => {
  if (fn.type !== "FunctionExpression" || !fn.generator) return false
  const call = fn.parent
  if (call?.type !== "CallExpression" || !call.arguments.includes(fn)) return false
  if (isMember(call.callee, "Effect", ["gen", "fn", "fnUntraced"])) return true
  return call.callee.type === "CallExpression" && isMember(call.callee.callee, "Effect", ["fn", "fnUntraced"])
}

const throwInEffectGen = {
  meta: meta("throw-in-effect-gen", 1, "problem"),
  create: (context) => ({
    ThrowStatement(node) {
      const fn = enclosingFunction(node)
      if (fn && isEffectGenerator(fn)) {
        context.report({
          node,
          message: `throw in an Effect generator becomes an untyped defect -> return yield* new MyError({ ... }); ${REF}/errors.md`
        })
      }
    }
  })
}

// Finalizers must not fail, so Effect.promise is the right tool there.
// Value: index of the finalizer argument, or "last" for dual APIs (data-last or data-first).
const FINALIZER_ARGUMENT = {
  acquireRelease: 1,
  acquireUseRelease: 2,
  addFinalizer: "last",
  ensuring: "last",
  onExit: "last",
  onInterrupt: "last",
  onError: "last"
}

const FINALIZER_NAMES = Object.keys(FINALIZER_ARGUMENT)

const isFinalizerCall = (call) =>
  ["Effect", "Stream", "Scope"].some((owner) => isMember(call.callee, owner, FINALIZER_NAMES))

const isInFinalizer = (node) => {
  let child = node
  let current = node.parent
  while (current) {
    if (current.type === "CallExpression" && isFinalizerCall(current)) {
      const position = FINALIZER_ARGUMENT[current.callee.property.name]
      const index = position === "last" ? current.arguments.length - 1 : position
      if (current.arguments[index] === child) return true
    }
    child = current
    current = current.parent
  }
  return false
}

const effectPromise = {
  meta: meta("effect-promise", 1, "problem"),
  create: (context) => ({
    MemberExpression(node) {
      if (!isMember(node, "Effect", ["promise"]) || isInFinalizer(node)) return
      context.report({
        node,
        message: `Effect.promise turns a rejection into a defect -> Effect.tryPromise({ try, catch: (cause) => new MyError({ cause }) }); ${REF}/errors.md`
      })
    }
  })
}

const optionGetOrThrow = {
  meta: meta("option-getorthrow", 1, "problem"),
  create: (context) => ({
    MemberExpression(node) {
      if (!isMember(node, "Option", ["getOrThrow", "getOrThrowWith"])) return
      context.report({
        node,
        message: `Option.${node.property.name} throws on None -> Option.match / Option.getOrElse, or yield* Effect.fromOption(o) in Effect code; ${REF}/data-types.md`
      })
    }
  })
}

// Matches on the last name segment so MAX_TOKENS, TOKEN_TTL or CACHE_KEY_PREFIX stay quiet.
const SECRET_SUFFIX = /(^|[_.-])(TOKEN|SECRET|PASSWORD|PASSWD|KEY|APIKEY)$/i
const PUBLIC_NAME = /PUBLIC|PUBLISHABLE/i

const secretConfigNotRedacted = {
  meta: meta("secret-config-not-redacted", 1, "problem"),
  create: (context) => ({
    CallExpression(node) {
      if (!isMember(node.callee, "Config", ["String", "NonEmptyString"])) return
      const name = stringValue(node.arguments[0])
      if (name === undefined || !SECRET_SUFFIX.test(name) || PUBLIC_NAME.test(name)) return
      context.report({
        node,
        message: `Config.${node.callee.property.name}("${name}") can leak into logs -> Config.Redacted("${name}"); ${REF}/config.md`
      })
    }
  })
}

// Duration position per call: "first" (Schedule.*, Effect.sleep) or "last" (dual Effect.timeout(self, d) / timeout(d)).
const DURATION_CALLS = [
  ["Effect", ["sleep"], "first"],
  ["Effect", ["timeout", "timeoutOption", "delay"], "last"],
  ["Schedule", ["spaced", "fixed", "exponential", "windowed", "fibonacci", "during", "duration"], "first"]
]

const durationArgument = (node) => {
  for (const [object, properties, position] of DURATION_CALLS) {
    if (!isMember(node.callee, object, properties)) continue
    return position === "first" ? node.arguments[0] : node.arguments.at(-1)
  }
  if (!isMember(node.callee, "Effect", ["timeoutOrElse"])) return undefined
  const options = node.arguments.at(-1)
  if (options?.type !== "ObjectExpression") return undefined
  return options.properties.find((p) => propertyNamed(p, "duration"))?.value
}

const durationText = (millis) => {
  if (millis < 1000 || millis % 1000 !== 0) return `${millis} millis`
  const seconds = millis / 1000
  return `${seconds} ${seconds === 1 ? "second" : "seconds"}`
}

const numericDuration = {
  meta: meta("numeric-duration", 1, "suggestion"),
  create: (context) => ({
    CallExpression(node) {
      const argument = durationArgument(node)
      if (!isNumber(argument)) return
      context.report({
        node: argument,
        message: `numeric duration ${argument.raw} hides its unit -> "${durationText(argument.value)}" or Duration.millis(${argument.raw}); ${REF}/schedule-retry.md`
      })
    }
  })
}

// A handler that never reads its error swallows it; one that maps the error (e.g. to a response) does not.
const ignoresError = (context, handler) => {
  if (handler.params.length === 0) return true
  if (handler.params[0].type !== "Identifier") return false
  const [error] = context.sourceCode.getDeclaredVariables(handler)
  return error?.references.length === 0
}

// The single returned expression of a handler: `() => x` or `() => { return x }`.
const handlerResult = (handler) => {
  if (handler.body.type !== "BlockStatement") return handler.body
  const [only] = handler.body.body
  return handler.body.body.length === 1 && only.type === "ReturnStatement" ? only.argument : undefined
}

const returnsSuccess = (handler) => {
  const result = handlerResult(handler)
  if (isMember(result, "Effect", ["void"])) return true
  return result?.type === "CallExpression" && isMember(result.callee, "Effect", ["succeed", "sync"])
}

// Effect.succeed({ _tag: "Failed", ... }): the failure becomes a success value shaped like an error.
const FAILURE_TAG = /fail|error/i

const succeedsWithFailureTag = (handler) => {
  const result = handlerResult(handler)
  if (result?.type !== "CallExpression" || !isMember(result.callee, "Effect", ["succeed"])) return false
  const value = result.arguments[0]
  if (value?.type !== "ObjectExpression") return false
  const tag = value.properties.find((p) => propertyNamed(p, "_tag"))
  return tag !== undefined && FAILURE_TAG.test(stringValue(unwrapCasts(tag.value)) ?? "")
}

const isInlineFunction = (node) => node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression"

const swallowingHandler = (context, call, name) => {
  if (!isMember(call.callee, "Effect", [name])) return false
  const handler = call.arguments.at(-1)
  return isInlineFunction(handler) && ignoresError(context, handler) && returnsSuccess(handler)
}

// UI code: a .tsx/.jsx file, or a module that imports a UI framework (hooks in plain .ts files count).
const UI_MODULE = /^(react|react-dom|react-native|preact|solid-js|vue|expo)(\/|$)|^(@tanstack\/(react|solid|vue)-|@effect\/atom-(react|solid|vue)|expo-|@expo\/)/

const isUiFile = (context, program) =>
  /\.[jt]sx$/.test(context.filename) ||
  program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      typeof statement.source.value === "string" &&
      UI_MODULE.test(statement.source.value)
  )

const ERROR_AS_SUCCESS = `turns the error into success before the UI edge, so Query's isError and retry never fire -> let the typed error reach queryFn and map its _tag to copy in the screen; ${REF}/errors.md`

const catchAllToSuccess = {
  meta: meta("catch-all-to-success", 2, "suggestion"),
  create: (context) => {
    let uiFile = false
    return {
      Program(node) {
        uiFile = isUiFile(context, node)
      },
      MemberExpression(node) {
        if (!uiFile || !isMember(node, "Effect", ["orElseSucceed"])) return
        context.report({ node, message: `Effect.orElseSucceed ${ERROR_AS_SUCCESS}` })
      },
      CallExpression(node) {
        if (swallowingHandler(context, node, "catch")) {
          context.report({
            node,
            message: `Effect.catch(() => Effect.succeed(...)) swallows every failure, even future ones -> Effect.catchTag("Expected", ...) for the errors you mean; ${REF}/errors.md`
          })
          return
        }
        if (!isMember(node.callee, "Effect", ["catch"])) return
        const handler = node.arguments.at(-1)
        if (!isInlineFunction(handler)) return
        if (succeedsWithFailureTag(handler) || (uiFile && returnsSuccess(handler))) {
          context.report({ node, message: `Effect.catch(... => Effect.succeed(...)) ${ERROR_AS_SUCCESS}` })
        }
      }
    }
  }
}

const RUN_METHODS = ["runPromise", "runPromiseExit", "runSync", "runSyncExit", "runFork", "runCallback"]
const QUERY_EDGES = ["queryFn", "mutationFn"]
const RUNTIME_MODULE = /runtime[^/\\]*$/i

const isInQueryEdge = (node) => {
  let child = node
  let current = node.parent
  while (current) {
    if (current.type === "Property" && current.value === child && QUERY_EDGES.some((name) => propertyNamed(current, name))) {
      return true
    }
    child = current
    current = current.parent
  }
  return false
}

const runInUi = {
  meta: meta("run-in-ui", 1, "problem"),
  create: (context) => {
    let uiFile = false
    return {
      Program(node) {
        uiFile = isUiFile(context, node) && !RUNTIME_MODULE.test(context.filename)
      },
      CallExpression(node) {
        const callee = node.callee
        if (!uiFile || callee.type !== "MemberExpression" || callee.computed) return
        if (callee.property.type !== "Identifier" || !RUN_METHODS.includes(callee.property.name)) return
        const name = context.sourceCode.getText(callee)
        if (isMember(callee, "Effect", RUN_METHODS)) {
          context.report({
            node,
            message: `${name} in UI code runs without the app layer and outlives the screen -> runtime.runPromise(effect, { signal }) inside a TanStack Query queryFn/mutationFn, or an atom; ${REF}/atom.md and expo/references/data-boundary.md`
          })
        } else if (!isInQueryEdge(node)) {
          context.report({
            node,
            message: `${name} in a component or hook outlives the screen and hides the typed error from the UI -> call it inside a TanStack Query queryFn/mutationFn with { signal }, or use an atom; expo/references/data-boundary.md`
          })
        }
      }
    }
  }
}

const isAssertion = (node) => {
  let callee = node.callee
  if (callee.type === "Identifier") return callee.name === "expect" || callee.name === "assert"
  if (callee.type !== "MemberExpression") return false
  if (!callee.computed && callee.property.type === "Identifier" && ["fail", "unreachable"].includes(callee.property.name)) {
    return false
  }
  while (callee.type === "MemberExpression" || callee.type === "CallExpression") {
    callee = callee.type === "MemberExpression" ? callee.object : callee.callee
  }
  return callee.type === "Identifier" && (callee.name === "expect" || callee.name === "assert")
}

const ASSERTS = /\b(expect|assert)\b/
const ASSERTS_OR_THROWS = /\b(expect|assert)\b|\bthrow\b/

// Texts that an earlier assertion must mention: the whole condition, or both sides of `a === b` / `a !== b`.
const conditionParts = (sourceCode, test) =>
  test.type === "BinaryExpression" && ["===", "==", "!==", "!="].includes(test.operator)
    ? [sourceCode.getText(test.left), sourceCode.getText(test.right)]
    : [sourceCode.getText(test)]

// assert.isTrue(Exit.isFailure(exit)) or assert.strictEqual(exit._tag, "Failure") earlier in the same block
// already fails the test when the if is skipped.
const conditionAssertedBefore = (sourceCode, ifStatement) => {
  const block = ifStatement.parent
  if (block?.type !== "BlockStatement") return false
  const parts = conditionParts(sourceCode, ifStatement.test)
  return block.body
    .slice(0, block.body.indexOf(ifStatement))
    .some((statement) => {
      const text = sourceCode.getText(statement)
      return ASSERTS.test(text) && parts.every((part) => text.includes(part))
    })
}

const LOOPS = ["ForStatement", "ForInStatement", "ForOfStatement", "WhileStatement", "DoWhileStatement"]

const isTestCallee = (callee) =>
  (callee.type === "Identifier" && TEST_FUNCTIONS.includes(callee.name)) ||
  (callee.type === "MemberExpression" && !callee.computed && callee.object.type === "Identifier" &&
    TEST_FUNCTIONS.includes(callee.object.name))

// The function passed to it / test / it.effect / ..., or the Effect.gen generator such a function builds.
// Helpers, fakes and spies branch on purpose, so ifs inside them are not judged.
const isTestBody = (fn) => {
  const call = fn?.parent
  if (call?.type !== "CallExpression" || !call.arguments.includes(fn)) return false
  if (isTestCallee(call.callee)) return true
  return isMember(call.callee, "Effect", ["gen"]) && isTestBody(enclosingFunction(call))
}

const expectInIf = {
  meta: meta("expect-in-if", 1, "problem"),
  create: (context) => {
    const reported = new Set()
    return {
      CallExpression(node) {
        if (!isAssertion(node)) return
        let child = node
        let current = node.parent
        let found
        while (current && !isFunction(current)) {
          // Table-driven loops branch per case on purpose.
          if (LOOPS.includes(current.type)) return
          if (!found && current.type === "IfStatement" && child !== current.test) found = { statement: current, branch: child }
          child = current
          current = current.parent
        }
        if (!found || !isTestBody(current)) return
        const { statement, branch } = found
        const other = branch === statement.consequent ? statement.alternate : statement.consequent
        const otherBranchChecks = other && ASSERTS_OR_THROWS.test(context.sourceCode.getText(other))
        if (otherBranchChecks || reported.has(statement) || conditionAssertedBefore(context.sourceCode, statement)) return
        reported.add(statement)
        context.report({
          node,
          message: `assertion inside if passes silently when the branch is skipped -> assert the condition first, then assert on the narrowed value; ${REF}/testing.md`
        })
      }
    }
  }
}

// Callbacks whose throw becomes a defect: Effect.sync / map / flatMap / andThen / tap, and Effect generators.
const SYNC_CALLBACKS = ["sync", "map", "flatMap", "andThen", "tap"]

const runsAsEffectCode = (fn) => {
  if (isEffectGenerator(fn)) return true
  const call = fn.parent
  return call?.type === "CallExpression" && call.arguments.includes(fn) && isMember(call.callee, "Effect", SYNC_CALLBACKS)
}

const insideTryBlock = (node, fn) => {
  let child = node
  let current = node.parent
  while (current && current !== fn) {
    if (current.type === "TryStatement" && current.block === child) return true
    child = current
    current = current.parent
  }
  return false
}

const jsonParseDefect = {
  meta: meta("json-parse-defect", 1, "problem"),
  create: (context) => ({
    CallExpression(node) {
      if (!isMember(node.callee, "JSON", ["parse"])) return
      const input = node.arguments[0]
      if (input?.type === "CallExpression" && isMember(input.callee, "JSON", ["stringify"])) return
      const fn = enclosingFunction(node)
      if (!fn || !runsAsEffectCode(fn) || insideTryBlock(node, fn)) return
      context.report({
        node,
        message: `JSON.parse throws on bad input, and here the throw becomes an untyped defect -> Schema.decodeUnknownEffect(Schema.fromJsonString(MySchema))(raw), or Effect.try({ try, catch }); ${REF}/schema.md`
      })
    }
  })
}

// The thunk of Effect.tryPromise(thunk) or Effect.tryPromise({ try: thunk, catch }).
const isTryPromiseThunk = (fn) => {
  const parent = fn.parent
  if (parent?.type === "CallExpression") return parent.arguments[0] === fn && isMember(parent.callee, "Effect", ["tryPromise"])
  if (parent?.type !== "Property" || !propertyNamed(parent, "try")) return false
  const call = parent.parent?.parent
  return call?.type === "CallExpression" && isMember(call.callee, "Effect", ["tryPromise"])
}

const passesSignal = (init) =>
  init !== undefined &&
  (init.type !== "ObjectExpression" ||
    init.properties.some((p) => p.type === "SpreadElement" || propertyNamed(p, "signal")))

const fetchWithoutSignal = {
  meta: meta("fetch-without-signal", 1, "problem"),
  create: (context) => ({
    CallExpression(node) {
      if (node.callee.type !== "Identifier" || node.callee.name !== "fetch") return
      const fn = enclosingFunction(node)
      if (!fn || !isTryPromiseThunk(fn) || passesSignal(node.arguments[1])) return
      context.report({
        node,
        message: `fetch in Effect.tryPromise keeps running after interruption -> try: (signal) => fetch(url, { signal }), or use HttpClient; ${REF}/http-client.md`
      })
    }
  })
}

// Log functions take any number of messages, so they log the index too.
const VARIADIC = [
  ["Effect", ["log", "logTrace", "logDebug", "logInfo", "logWarning", "logError", "logFatal"]],
  ["Console", ["log", "info", "warn", "error", "debug", "trace"]]
]

// The function behind `const f = (a, b) => ...` or `const f = Effect.fn("f")(function*(a, b) {...})`.
const declaredFunction = (init) => {
  if (!init) return undefined
  if (isInlineFunction(init)) return init
  if (init.type !== "CallExpression") return undefined
  const callee = init.callee
  const isFn = isMember(callee, "Effect", ["fn", "fnUntraced"]) ||
    (callee.type === "CallExpression" && isMember(callee.callee, "Effect", ["fn", "fnUntraced"]))
  return isFn ? init.arguments.find(isInlineFunction) : undefined
}

const takesSecondArgument = (fn) => fn.params.length >= 2 || fn.params.some((p) => p.type === "RestElement")

const pointFreeForEach = {
  meta: meta("point-free-foreach", 1, "problem"),
  create: (context) => {
    const multiParam = new Set()
    const callbacks = []
    const record = (name, fn) => {
      if (fn && takesSecondArgument(fn)) multiParam.add(name)
    }
    return {
      FunctionDeclaration(node) {
        if (node.id) record(node.id.name, node)
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier") record(node.id.name, declaredFunction(node.init))
      },
      CallExpression(node) {
        if (!isMember(node.callee, "Effect", ["forEach"])) return
        const [first, second] = node.arguments
        const callback = second && second.type !== "ObjectExpression" ? second : first
        if (callback?.type === "Identifier" || callback?.type === "MemberExpression") callbacks.push(callback)
      },
      "Program:exit"() {
        for (const callback of callbacks) {
          const leaks = callback.type === "Identifier"
            ? multiParam.has(callback.name)
            : VARIADIC.some(([object, properties]) => isMember(callback, object, properties))
          if (!leaks) continue
          const name = context.sourceCode.getText(callback)
          context.report({
            node: callback,
            message: `Effect.forEach calls f(item, index), and ${name} takes a second argument, so it gets the index -> (item) => ${name}(item); ${REF}/effect-core.md`
          })
        }
      }
    }
  }
}

const importsEffect = (program) =>
  program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      typeof statement.source.value === "string" &&
      /^(effect|@effect\/)/.test(statement.source.value)
  )

const processExit = {
  meta: meta("process-exit", 1, "problem"),
  create: (context) => {
    let effectFile = false
    return {
      Program(node) {
        effectFile = importsEffect(node)
      },
      CallExpression(node) {
        // At module top level (argv checks before the program starts) no scope is open yet.
        if (!effectFile || !isMember(node.callee, "process", ["exit"]) || !enclosingFunction(node)) return
        context.report({
          node,
          message: `process.exit skips Effect finalizers and open scopes -> fail the main effect and let BunRuntime.runMain / NodeRuntime.runMain set the exit code; ${REF}/runtime.md`
        })
      }
    }
  }
}

const SWALLOW_CAUSE = `swallows defects and interruption too -> Effect.ignore or Effect.catchTag for expected errors; keep it only for best-effort cleanup, with a reasoned disable; ${REF}/errors.md`

const swallowCause = {
  meta: meta("swallow-cause", 1, "problem"),
  create: (context) => ({
    MemberExpression(node) {
      if (!isMember(node, "Effect", ["ignoreCause"]) || isInFinalizer(node)) return
      context.report({ node, message: `Effect.ignoreCause ${SWALLOW_CAUSE}` })
    },
    CallExpression(node) {
      if (!swallowingHandler(context, node, "catchCause") || isInFinalizer(node)) return
      context.report({ node, message: `Effect.catchCause(() => success) ${SWALLOW_CAUSE}` })
    }
  })
}

const isQualifiedType = (type, left, right) =>
  type?.type === "TSTypeReference" &&
  type.typeName.type === "TSQualifiedName" &&
  type.typeName.left.type === "Identifier" &&
  type.typeName.left.name === left &&
  type.typeName.right.name === right

const callsLayer = (node) => node?.type === "CallExpression" && node.callee.type === "MemberExpression" &&
  (isMember(node.callee, "Layer", [node.callee.property.name]) ||
    (node.callee.property.name === "pipe" &&
      node.arguments.some((a) => a.type === "CallExpression" && a.callee.object?.name === "Layer")))

const unwrapCasts = (node) => (node.type === "TSAsExpression" || node.type === "TSTypeAssertion" ? unwrapCasts(node.expression) : node)

const castsAwayRequirements = (node) => {
  const type = node.typeAnnotation
  if (isQualifiedType(type, "Layer", "Layer")) return true
  if (isQualifiedType(type, "Effect", "Effect")) {
    const params = (type.typeArguments ?? type.typeParameters)?.params
    return params?.length === 3 && params[2].type === "TSNeverKeyword"
  }
  return (type.type === "TSAnyKeyword" || type.type === "TSNeverKeyword") && callsLayer(unwrapCasts(node.expression))
}

const castRequirements = {
  meta: meta("cast-requirements", 1, "problem"),
  create: (context) => {
    const check = (node) => {
      if (!castsAwayRequirements(node)) return
      context.report({
        node,
        message: `a cast on a Layer or Effect hides a missing requirement until runtime -> provide it (Layer.provide / Effect.provide) until R is never; ${REF}/services-layers.md`
      })
    }
    return { TSAsExpression: check, TSTypeAssertion: check }
  }
}

const refGetThenSet = {
  meta: meta("ref-get-then-set", 1, "problem"),
  create: (context) => {
    const readRefs = new Map()
    return {
      CallExpression(node) {
        const isGet = isMember(node.callee, "Ref", ["get"]) && node.arguments.length === 1
        const isSet = isMember(node.callee, "Ref", ["set"]) && node.arguments.length === 2
        if (!isGet && !isSet) return
        const fn = enclosingFunction(node)
        const ref = context.sourceCode.getText(node.arguments[0])
        if (isGet) {
          readRefs.set(fn, (readRefs.get(fn) ?? new Set()).add(ref))
          return
        }
        if (!readRefs.get(fn)?.has(ref)) return
        context.report({
          node,
          message: `Ref.get then Ref.set on ${ref} loses updates from other fibers -> Ref.update(${ref}, f) or Ref.modify(${ref}, f) in one step; ${REF}/concurrency.md`
        })
      }
    }
  }
}

const TEST_FUNCTIONS = ["it", "test"]

const isPlainTestCall = (node) => {
  const callee = node.callee
  if (callee.type === "Identifier") return TEST_FUNCTIONS.includes(callee.name)
  return TEST_FUNCTIONS.some((name) => isMember(callee, name, ["only"]))
}

const isEffectApi = (node) =>
  node?.type === "MemberExpression" && isMember(node, "Effect", [node.property.name]) && !node.property.name.startsWith("run")

// An Effect value: Effect.gen(...), Effect.void, or x.pipe(..., Effect.y) that does not end in Effect.run*.
const isEffectValue = (node) => {
  if (node?.type === "MemberExpression") return isEffectApi(node)
  if (node?.type !== "CallExpression") return false
  if (isEffectApi(node.callee)) return true
  if (node.callee.type !== "MemberExpression" || node.callee.property.name !== "pipe") return false
  const last = node.arguments.at(-1)
  if (last?.type === "MemberExpression" && isMember(last, "Effect", [last.property.name]) && !isEffectApi(last)) return false
  return isEffectValue(node.callee.object) || node.arguments.some((a) => isEffectApi(a) || isEffectApi(a.callee))
}

const returnedValues = (fn) =>
  fn.body.type === "BlockStatement"
    ? fn.body.body.flatMap((s) => (s.type === "ReturnStatement" && s.argument ? [s.argument] : []))
    : [fn.body]

const effectInPlainIt = {
  meta: meta("effect-in-plain-it", 1, "problem"),
  create: (context) => ({
    CallExpression(node) {
      if (!isPlainTestCall(node)) return
      const body = node.arguments.find(isInlineFunction)
      const value = body && returnedValues(body).find(isEffectValue)
      if (!value) return
      context.report({
        node: value,
        message: `plain it() never runs a returned Effect, so the test passes without running it -> it.effect("...", () => Effect.gen(...)); ${REF}/testing.md`
      })
    }
  })
}

export default {
  meta: { name: "effect-skill" },
  rules: {
    "throw-in-effect-gen": throwInEffectGen,
    "effect-promise": effectPromise,
    "option-getorthrow": optionGetOrThrow,
    "secret-config-not-redacted": secretConfigNotRedacted,
    "numeric-duration": numericDuration,
    "catch-all-to-success": catchAllToSuccess,
    "expect-in-if": expectInIf,
    "json-parse-defect": jsonParseDefect,
    "fetch-without-signal": fetchWithoutSignal,
    "point-free-foreach": pointFreeForEach,
    "process-exit": processExit,
    "swallow-cause": swallowCause,
    "cast-requirements": castRequirements,
    "ref-get-then-set": refGetThenSet,
    "effect-in-plain-it": effectInPlainIt,
    "run-in-ui": runInUi
  }
}
