import {
  isTSNamespace,
  resolveTSProperties,
  resolveTSReferencedType,
  type TSNamespace,
  type TSResolvedType,
} from '../ts'
import type { Node } from '@babel/types'

export const UNKNOWN_TYPE = 'Unknown'

export async function inferRuntimeType(
  node: TSResolvedType | TSNamespace,
): Promise<string[]> {
  if (isTSNamespace(node)) return ['Object']

  switch (node.type.type) {
    case 'TSStringKeyword':
      return ['String']
    case 'TSNumberKeyword':
      return ['Number']
    case 'TSBooleanKeyword':
      return ['Boolean']
    case 'TSObjectKeyword':
      return ['Object']
    case 'TSInterfaceDeclaration':
    case 'TSTypeLiteral': {
      // TODO (nice to have) generate runtime property validation

      const resolved = await resolveTSProperties({
        type: node.type,
        scope: node.scope,
      })
      const types = new Set<string>()

      if (
        resolved.callSignatures.length ||
        resolved.constructSignatures.length
      ) {
        types.add('Function')
      }
      if (
        Object.keys(resolved.methods).length ||
        Object.keys(resolved.properties).length
      ) {
        types.add('Object')
      }

      return Array.from(types)
    }
    case 'TSFunctionType':
      return ['Function']
    case 'TSArrayType':
    case 'TSTupleType':
      // TODO (nice to have) generate runtime element type/length checks
      return ['Array']

    case 'TSLiteralType':
      switch (node.type.literal.type) {
        case 'StringLiteral':
          return ['String']
        case 'BooleanLiteral':
          return ['Boolean']
        case 'NumericLiteral':
        case 'BigIntLiteral':
          return ['Number']
      }
      break

    case 'TSTypeReference':
      if (node.type.typeName.type === 'Identifier') {
        switch (node.type.typeName.name) {
          case 'Array':
          case 'Function':
          case 'Object':
          case 'Set':
          case 'Map':
          case 'WeakSet':
          case 'WeakMap':
          case 'Date':
          case 'Promise':
            return [node.type.typeName.name]
          case 'Record':
          case 'Partial':
          case 'Readonly':
          case 'Pick':
          case 'Omit':
          case 'Required':
          case 'InstanceType':
            return ['Object']

          case 'Extract':
            if (
              node.type.typeParameters &&
              node.type.typeParameters.params[1]
            ) {
              const t = await resolveTSReferencedType({
                scope: node.scope,
                type: node.type.typeParameters.params[1],
              })
              if (t) return inferRuntimeType(t)
            }
            break
          case 'Exclude':
            if (
              node.type.typeParameters &&
              node.type.typeParameters.params[0]
            ) {
              const t = await resolveTSReferencedType({
                scope: node.scope,
                type: node.type.typeParameters.params[0],
              })
              if (t) return inferRuntimeType(t)
            }
            break
        }
      }
      break

    case 'TSUnionType': {
      const types = (
        await Promise.all(
          node.type.types.map(async (subType) => {
            const resolved = await resolveTSReferencedType({
              scope: node.scope,
              type: subType,
            })
            return resolved && !isTSNamespace(resolved)
              ? inferRuntimeType(resolved)
              : undefined
          }),
        )
      ).flatMap((t) => (t ? t : ['null']))
      return [...new Set(types)]
    }
    case 'TSIntersectionType':
      return ['Object']

    case 'TSSymbolKeyword':
      return ['Symbol']
  }

  // no runtime check
  return [UNKNOWN_TYPE]
}

export function attachNodeLoc(node: Node, newNode: Node): void {
  newNode.start = node.start
  newNode.end = node.end
}

export function genRuntimePropDefinition(
  types: string[] | undefined,
  isProduction: boolean,
  properties: string[],
): string {
  let type: string | undefined
  let skipCheck = false

  if (types) {
    const hasBoolean = types.includes('Boolean')
    const hasUnknown = types.includes(UNKNOWN_TYPE)

    if (isProduction || hasUnknown) {
      types = types.filter(
        (t) =>
          t === 'Boolean' || (hasBoolean && t === 'String') || t === 'Function',
      )

      skipCheck = !isProduction && hasUnknown && types.length > 0
    }

    if (types.length > 0) {
      type = types.length > 1 ? `[${types.join(', ')}]` : types[0]
    }
  }

  const pairs: string[] = []
  if (type) pairs.push(`type: ${type}`)
  if (skipCheck) pairs.push(`skipCheck: true`)
  pairs.push(...properties)

  return pairs.length > 0 ? `{ ${pairs.join(', ')} }` : 'null'
}
