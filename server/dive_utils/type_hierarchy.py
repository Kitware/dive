from typing import Dict, List, Literal, Optional

from typing_extensions import NotRequired, TypedDict


class TypeHierarchyError(ValueError):
    reason: str
    kind: Literal['malformed', 'conflict']

    def __init__(
        self,
        reason: str,
        kind: Literal['malformed', 'conflict'] = 'malformed',
    ) -> None:
        super().__init__(reason)
        self.reason = reason
        self.kind = kind


class HierarchyWrite(TypedDict):
    action: Literal['none', 'delete', 'set']
    hierarchy: NotRequired[Dict[str, str]]


def _cycle_reason(hierarchy: Dict[str, str]) -> Optional[str]:
    completed = set()
    rendered_cycles: List[str] = []
    for start in sorted(hierarchy):
        if start in completed:
            continue
        path: List[str] = []
        positions: Dict[str, int] = {}
        current = start
        while current in hierarchy and current not in completed and current not in positions:
            positions[current] = len(path)
            path.append(current)
            current = hierarchy[current]
        if current in positions:
            cycle = path[positions[current] :]
            smallest = cycle.index(min(cycle))
            rotated = cycle[smallest:] + cycle[:smallest]
            rendered_cycles.append(' -> '.join(rotated + [rotated[0]]))
        completed.update(path)
    if not rendered_cycles:
        return None
    rendered_cycles.sort()
    return f'cycle {rendered_cycles[0]}'


# Mirrors client/dive-common/typeHierarchy.ts so headless imports and client saves agree.
def normalize_type_hierarchy(value: object) -> Optional[Dict[str, str]]:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise TypeHierarchyError('expected an object')
    if not value:
        return None
    if any(not isinstance(child, str) for child in value):
        raise TypeHierarchyError('expected an object')

    normalized: Dict[str, str] = {}
    for child in sorted(value):
        if not child.strip():
            raise TypeHierarchyError('empty child')
        parent = value[child]
        if not isinstance(parent, str):
            raise TypeHierarchyError(f'parent for "{child}" must be a string')
        if not parent.strip():
            raise TypeHierarchyError(f'empty parent for "{child}"')
        if child == parent:
            raise TypeHierarchyError(f'self edge "{child} -> {parent}"')
        normalized[child] = parent

    reason = _cycle_reason(normalized)
    if reason is not None:
        raise TypeHierarchyError(reason)
    return normalized


def _conflict(reason: str) -> TypeHierarchyError:
    return TypeHierarchyError(reason, 'conflict')


def resolve_type_hierarchy(
    existing: object,
    incoming_present: bool,
    incoming: object,
    mode: Literal['save', 'overwrite', 'additive'],
) -> HierarchyWrite:
    if not incoming_present:
        return {'action': 'none'}

    normalized_incoming = normalize_type_hierarchy(incoming)
    if normalized_incoming is None:
        # Additive follows JSON merge semantics: an explicit null deletes, an empty map is a no-op.
        if mode == 'additive' and incoming is not None:
            return {'action': 'none'}
        return {'action': 'delete'}
    if mode != 'additive':
        return {'action': 'set', 'hierarchy': normalized_incoming}

    try:
        normalized_existing = normalize_type_hierarchy(existing)
    except TypeHierarchyError as error:
        raise _conflict(error.reason) from error

    merged = dict(normalized_existing or {})
    for child in sorted(normalized_incoming):
        incoming_parent = normalized_incoming[child]
        if child in merged and merged[child] != incoming_parent:
            raise _conflict(
                f'conflicting parents for "{child}": ' f'"{merged[child]}" and "{incoming_parent}"'
            )
        merged[child] = incoming_parent

    try:
        normalized_merged = normalize_type_hierarchy(merged)
    except TypeHierarchyError as error:
        raise _conflict(error.reason) from error
    return {'action': 'set', 'hierarchy': normalized_merged or {}}


def apply_hierarchy_write(payload: dict, hierarchy_write: HierarchyWrite) -> dict:
    """Return ``payload`` with the resolved typeHierarchy applied, leaving it alone on 'none'."""
    resolved = dict(payload)
    if hierarchy_write['action'] == 'set':
        resolved['typeHierarchy'] = hierarchy_write['hierarchy']
    elif hierarchy_write['action'] == 'delete':
        resolved['typeHierarchy'] = None
    return resolved
