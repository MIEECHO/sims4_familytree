const STORAGE_KEY = 'chronokin.v1';

const state = {
  people: [],
  relations: [],
  editingPersonId: null,
  selectedPersonId: null,
};

const personForm = document.getElementById('personForm');
const personIdInput = document.getElementById('personId');
const personNameInput = document.getElementById('personName');
const personGenderInput = document.getElementById('personGender');
const personBirthInput = document.getElementById('personBirth');
const personNoteInput = document.getElementById('personNote');
const personAvatarInput = document.getElementById('personAvatar');
const personAvatarFileInput = document.getElementById('personAvatarFile');
const avatarPreview = document.getElementById('avatarPreview');
const avatarPlaceholder = document.getElementById('avatarPlaceholder');
const clearAvatarBtn = document.getElementById('clearAvatarBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const peopleList = document.getElementById('peopleList');

const relationForm = document.getElementById('relationForm');
const fromIdInput = document.getElementById('fromId');
const toIdInput = document.getElementById('toId');
const relationTypeInput = document.getElementById('relationType');
const relationList = document.getElementById('relationList');

const vizContainer = document.getElementById('vizContainer');
const treeSvg = document.getElementById('treeSvg');
const relationHint = document.getElementById('relationHint');
const stats = document.getElementById('stats');

const seedBtn = document.getElementById('seedBtn');
const resetBtn = document.getElementById('resetBtn');
const exportBtn = document.getElementById('exportBtn');

const relationName = {
  parent: '父母',
  spouse: '配偶',
  sibling: '兄弟姐妹',
};

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    people: state.people,
    relations: state.relations,
  }));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.people) || !Array.isArray(parsed.relations)) return;
    state.people = parsed.people.map((p, idx) => ({
      ...p,
      avatar: p.avatar || '',
      manualOrder: Number.isFinite(p.manualOrder) ? p.manualOrder : idx,
    }));
    state.relations = parsed.relations;
  } catch {
    // ignore corrupt data
  }
}

function getPersonById(id) {
  return state.people.find((p) => p.id === id);
}

function ensureManualOrder() {
  state.people.forEach((p, idx) => {
    if (!Number.isFinite(p.manualOrder)) p.manualOrder = idx;
  });
}

function getOrderedPeople() {
  ensureManualOrder();
  return state.people
    .slice()
    .sort((a, b) => (a.manualOrder - b.manualOrder) || a.name.localeCompare(b.name, 'zh-CN'));
}

function movePersonOrder(personId, step) {
  const ordered = getOrderedPeople();
  const idx = ordered.findIndex((p) => p.id === personId);
  const target = idx + step;
  if (idx < 0 || target < 0 || target >= ordered.length) return;

  const cur = ordered[idx];
  const next = ordered[target];
  const tmp = cur.manualOrder;
  cur.manualOrder = next.manualOrder;
  next.manualOrder = tmp;
  persistAndRender();
}

function sanitizeRelations() {
  const valid = new Set(state.people.map((p) => p.id));
  state.relations = state.relations.filter((r) => valid.has(r.from) && valid.has(r.to) && r.from !== r.to);
}

function clearPersonForm() {
  state.editingPersonId = null;
  personIdInput.value = '';
  personNameInput.value = '';
  personGenderInput.value = 'unknown';
  personBirthInput.value = '';
  personNoteInput.value = '';
  personAvatarInput.value = '';
  personAvatarFileInput.value = '';
  setAvatarPreview('');
}

function setPersonForm(person) {
  state.editingPersonId = person.id;
  personIdInput.value = person.id;
  personNameInput.value = person.name;
  personGenderInput.value = person.gender;
  personBirthInput.value = person.birth || '';
  personNoteInput.value = person.note || '';
  personAvatarInput.value = person.avatar || '';
  personAvatarFileInput.value = '';
  setAvatarPreview(person.avatar || '');
}

function setAvatarPreview(src) {
  const wrap = avatarPreview.parentElement;
  if (!src) {
    avatarPreview.removeAttribute('src');
    wrap.classList.remove('has-avatar');
    avatarPlaceholder.textContent = '未设置头像';
    return;
  }
  avatarPreview.src = src;
  wrap.classList.add('has-avatar');
}

function renderPeopleList() {
  peopleList.textContent = '';
  const tpl = document.getElementById('personItemTemplate');

  const ordered = getOrderedPeople();
  ordered.forEach((person, index) => {
      const li = tpl.content.firstElementChild.cloneNode(true);
      const main = li.querySelector('.row-main');
      const birth = person.birth ? ` (${person.birth})` : '';
      const note = person.note ? ` · ${person.note}` : '';
      const genderLabel = person.gender === 'male' ? '男' : person.gender === 'female' ? '女' : '未知';
      main.textContent = `${person.name}${birth} · ${genderLabel}${note}`;

      li.querySelector('.edit').addEventListener('click', () => setPersonForm(person));
      li.querySelector('.delete').addEventListener('click', () => {
        state.people = state.people.filter((p) => p.id !== person.id);
        sanitizeRelations();
        if (state.editingPersonId === person.id) clearPersonForm();
        persistAndRender();
      });

      const actions = li.querySelector('.row-actions');
      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'ghost small';
      upBtn.textContent = '↑';
      upBtn.disabled = index === 0;
      upBtn.addEventListener('click', () => movePersonOrder(person.id, -1));

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'ghost small';
      downBtn.textContent = '↓';
      downBtn.disabled = index === ordered.length - 1;
      downBtn.addEventListener('click', () => movePersonOrder(person.id, 1));

      actions.prepend(downBtn);
      actions.prepend(upBtn);

      peopleList.appendChild(li);
  });
}

function relationToText(r) {
  const a = getPersonById(r.from);
  const b = getPersonById(r.to);
  if (!a || !b) return '无效关系';

  if (r.type === 'parent') return `${a.name} 是 ${b.name} 的父/母`;
  if (r.type === 'spouse') return `${a.name} 与 ${b.name} 是配偶`;
  return `${a.name} 与 ${b.name} 是兄弟姐妹`;
}

function inferDerivedRelations() {
  const childrenByParent = new Map();
  const parentsByChild = new Map();

  for (const r of state.relations) {
    if (r.type !== 'parent') continue;
    if (!childrenByParent.has(r.from)) childrenByParent.set(r.from, new Set());
    childrenByParent.get(r.from).add(r.to);
    if (!parentsByChild.has(r.to)) parentsByChild.set(r.to, new Set());
    parentsByChild.get(r.to).add(r.from);
  }

  const siblingPairsFromParent = new Set();
  for (const children of childrenByParent.values()) {
    const arr = [...children];
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length; j += 1) {
        siblingPairsFromParent.add([arr[i], arr[j]].sort().join(':'));
      }
    }
  }

  const siblingPairsExplicit = new Set();
  for (const r of state.relations) {
    if (r.type !== 'sibling') continue;
    siblingPairsExplicit.add([r.from, r.to].sort().join(':'));
  }

  const siblingPairs = new Set([...siblingPairsFromParent, ...siblingPairsExplicit]);
  const siblingsByPerson = new Map();
  for (const key of siblingPairs) {
    const [a, b] = key.split(':');
    if (!siblingsByPerson.has(a)) siblingsByPerson.set(a, new Set());
    if (!siblingsByPerson.has(b)) siblingsByPerson.set(b, new Set());
    siblingsByPerson.get(a).add(b);
    siblingsByPerson.get(b).add(a);
  }

  const grandparentPairs = new Set();
  for (const [grandParentId, children] of childrenByParent.entries()) {
    for (const parentId of children) {
      const grandChildren = childrenByParent.get(parentId);
      if (!grandChildren) continue;
      for (const grandChildId of grandChildren) {
        if (grandParentId === grandChildId) continue;
        grandparentPairs.add(`${grandParentId}:${grandChildId}`);
      }
    }
  }

  const greatGrandparentPairs = new Set();
  for (const [greatGrandParentId, children] of childrenByParent.entries()) {
    for (const grandParentId of children) {
      const parents = childrenByParent.get(grandParentId);
      if (!parents) continue;
      for (const parentId of parents) {
        const grandChildren = childrenByParent.get(parentId);
        if (!grandChildren) continue;
        for (const childId of grandChildren) {
          if (greatGrandParentId === childId) continue;
          greatGrandparentPairs.add(`${greatGrandParentId}:${childId}`);
        }
      }
    }
  }

  const uncleAuntPairs = new Set();
  for (const [childId, parents] of parentsByChild.entries()) {
    for (const parentId of parents) {
      const siblings = siblingsByPerson.get(parentId);
      if (!siblings) continue;
      for (const siblingId of siblings) {
        if (siblingId === childId) continue;
        uncleAuntPairs.add(`${siblingId}:${childId}`);
      }
    }
  }

  const cousinPairs = new Set();
  for (const [childId, parents] of parentsByChild.entries()) {
    for (const parentId of parents) {
      const parentSiblings = siblingsByPerson.get(parentId);
      if (!parentSiblings) continue;
      for (const psId of parentSiblings) {
        const cousinCandidates = childrenByParent.get(psId);
        if (!cousinCandidates) continue;
        for (const cousinId of cousinCandidates) {
          if (cousinId === childId) continue;
          cousinPairs.add([childId, cousinId].sort().join(':'));
        }
      }
    }
  }

  return { siblingPairs, grandparentPairs, greatGrandparentPairs, uncleAuntPairs, cousinPairs };
}

function pairRelationText(aId, bId) {
  const a = getPersonById(aId);
  const b = getPersonById(bId);
  if (!a || !b || aId === bId) return '';

  const elderGrandLabel = a.gender === 'male' ? '祖父' : a.gender === 'female' ? '祖母' : '祖父/母';
  const youngerGrandLabel = a.gender === 'male' ? '孙子' : a.gender === 'female' ? '孙女' : '孙辈';
  const elderGreatGrandLabel = a.gender === 'male' ? '曾祖父' : a.gender === 'female' ? '曾祖母' : '曾祖父/母';
  const youngerGreatGrandLabel = a.gender === 'male' ? '曾孙' : a.gender === 'female' ? '曾孙女' : '曾孙辈';
  const uncleAuntLabel = a.gender === 'male' ? '叔叔' : a.gender === 'female' ? '阿姨' : '叔叔/阿姨';
  const nephewNieceLabel = a.gender === 'male' ? '侄子/外甥' : a.gender === 'female' ? '侄女/外甥女' : '侄辈/外甥辈';

  const texts = [];
  for (const r of state.relations) {
    if (r.type === 'spouse') {
      if ((r.from === aId && r.to === bId) || (r.from === bId && r.to === aId)) {
        texts.push(`${a.name} 与 ${b.name} 是配偶`);
      }
      continue;
    }
    if (r.type === 'sibling') {
      if ((r.from === aId && r.to === bId) || (r.from === bId && r.to === aId)) {
        texts.push(`${a.name} 与 ${b.name} 是兄弟姐妹`);
      }
      continue;
    }
    if (r.type === 'parent') {
      if (r.from === aId && r.to === bId) texts.push(`${a.name} 是 ${b.name} 的父/母`);
      if (r.from === bId && r.to === aId) texts.push(`${a.name} 是 ${b.name} 的子女`);
    }
  }

  const derived = inferDerivedRelations();
  const siblingKey = [aId, bId].sort().join(':');
  if (derived.siblingPairs.has(siblingKey)) {
    texts.push(`${a.name} 与 ${b.name} 是兄弟姐妹`);
  }
  if (derived.grandparentPairs.has(`${aId}:${bId}`)) {
    texts.push(`${a.name} 是 ${b.name} 的${elderGrandLabel}`);
  }
  if (derived.grandparentPairs.has(`${bId}:${aId}`)) {
    texts.push(`${a.name} 是 ${b.name} 的${youngerGrandLabel}`);
  }
  if (derived.greatGrandparentPairs.has(`${aId}:${bId}`)) {
    texts.push(`${a.name} 是 ${b.name} 的${elderGreatGrandLabel}`);
  }
  if (derived.greatGrandparentPairs.has(`${bId}:${aId}`)) {
    texts.push(`${a.name} 是 ${b.name} 的${youngerGreatGrandLabel}`);
  }
  if (derived.uncleAuntPairs.has(`${aId}:${bId}`)) {
    texts.push(`${a.name} 是 ${b.name} 的${uncleAuntLabel}`);
  }
  if (derived.uncleAuntPairs.has(`${bId}:${aId}`)) {
    texts.push(`${a.name} 是 ${b.name} 的${nephewNieceLabel}`);
  }
  if (derived.cousinPairs.has(siblingKey)) {
    texts.push(`${a.name} 与 ${b.name} 是表亲`);
  }

  return [...new Set(texts)].join('；');
}

function updateRelationHintPosition(evt) {
  if (!evt) return;
  const rect = vizContainer.getBoundingClientRect();
  const offset = 14;
  const pad = 8;
  const rawX = vizContainer.scrollLeft + (evt.clientX - rect.left) + offset;
  const rawY = vizContainer.scrollTop + (evt.clientY - rect.top) + offset;
  const hintW = relationHint.offsetWidth || 0;
  const hintH = relationHint.offsetHeight || 0;

  const minX = vizContainer.scrollLeft + pad;
  const minY = vizContainer.scrollTop + pad;
  const maxX = vizContainer.scrollLeft + vizContainer.clientWidth - hintW - pad;
  const maxY = vizContainer.scrollTop + vizContainer.clientHeight - hintH - pad;

  const x = Math.max(minX, Math.min(rawX, maxX));
  const y = Math.max(minY, Math.min(rawY, maxY));
  relationHint.style.left = `${x}px`;
  relationHint.style.top = `${y}px`;
}

function showRelationHint(text, evt) {
  relationHint.textContent = text;
  relationHint.style.display = text ? 'inline-flex' : 'none';
  if (text) updateRelationHintPosition(evt);
}

function hideRelationHint() {
  relationHint.textContent = '';
  relationHint.style.display = 'none';
}

function dedupeRelations() {
  const seen = new Set();
  state.relations = state.relations.filter((r) => {
    const bidir = r.type === 'spouse' || r.type === 'sibling';
    const key = bidir
      ? `${r.type}:${[r.from, r.to].sort().join(':')}`
      : `${r.type}:${r.from}:${r.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderRelationList() {
  relationList.textContent = '';
  const tpl = document.getElementById('relationItemTemplate');

  state.relations.forEach((r, idx) => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.querySelector('.row-main').textContent = relationToText(r);
    li.querySelector('.delete').addEventListener('click', () => {
      state.relations.splice(idx, 1);
      persistAndRender();
    });
    relationList.appendChild(li);
  });
}

function renderPersonOptions() {
  const entries = getOrderedPeople()
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join('');
  fromIdInput.innerHTML = `<option value="">请选择</option>${entries}`;
  toIdInput.innerHTML = `<option value="">请选择</option>${entries}`;
}

function computeGenerations() {
  const parentsByChild = new Map();
  const childrenByParent = new Map();

  for (const r of state.relations) {
    if (r.type !== 'parent') continue;
    if (!parentsByChild.has(r.to)) parentsByChild.set(r.to, []);
    parentsByChild.get(r.to).push(r.from);
    if (!childrenByParent.has(r.from)) childrenByParent.set(r.from, []);
    childrenByParent.get(r.from).push(r.to);
  }

  const gen = new Map();
  for (const p of state.people) gen.set(p.id, 0);

  let changed = true;
  let rounds = 0;
  while (changed && rounds < state.people.length + 2) {
    changed = false;
    rounds += 1;
    for (const r of state.relations) {
      if (r.type !== 'parent') continue;
      const parentGen = gen.get(r.from) ?? 0;
      const childGen = gen.get(r.to) ?? 0;
      if (childGen <= parentGen) {
        gen.set(r.to, parentGen + 1);
        changed = true;
      }
    }
  }

  for (const r of state.relations) {
    if (r.type !== 'spouse' && r.type !== 'sibling') continue;
    const a = gen.get(r.from) ?? 0;
    const b = gen.get(r.to) ?? 0;
    const avg = Math.round((a + b) / 2);
    gen.set(r.from, avg);
    gen.set(r.to, avg);
  }

  const columns = new Map();
  for (const p of state.people) {
    const g = gen.get(p.id) ?? 0;
    if (!columns.has(g)) columns.set(g, []);
    columns.get(g).push(p.id);
  }

  for (const ids of columns.values()) {
    ids.sort((a, b) => {
      const pa = getPersonById(a);
      const pb = getPersonById(b);
      return (pa?.manualOrder ?? 0) - (pb?.manualOrder ?? 0)
        || (pa?.birth || 9999) - (pb?.birth || 9999)
        || pa.name.localeCompare(pb.name, 'zh-CN');
    });
  }

  return columns;
}

function nodeColor(gender) {
  if (gender === 'male') return 'rgba(38, 171, 255, 0.85)';
  if (gender === 'female') return 'rgba(255, 117, 181, 0.85)';
  return 'rgba(148, 178, 200, 0.85)';
}

function makeSvgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, String(v)));
  return el;
}

function drawTree() {
  treeSvg.innerHTML = '';
  const nodeW = 172;
  const nodeH = 64;
  const xGap = 46;
  const yGap = 90;
  const pad = 36;

  if (state.people.length === 0) {
    const txt = makeSvgEl('text', { x: 30, y: 50, fill: '#8db6ca' });
    txt.textContent = '请先添加人物与关系';
    treeSvg.appendChild(txt);
    treeSvg.setAttribute('viewBox', '0 0 900 620');
    return;
  }

  const cols = computeGenerations();
  const levels = [...cols.keys()].sort((a, b) => a - b);

  const positions = new Map();
  let maxWidthNodes = 1;
  for (const lvl of levels) {
    maxWidthNodes = Math.max(maxWidthNodes, cols.get(lvl).length);
  }

  const totalW = Math.max(900, pad * 2 + maxWidthNodes * nodeW + (maxWidthNodes - 1) * xGap);
  const totalH = Math.max(620, pad * 2 + levels.length * nodeH + (levels.length - 1) * yGap + 40);
  treeSvg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

  for (let i = 0; i < levels.length; i += 1) {
    const ids = cols.get(levels[i]);
    const rowWidth = ids.length * nodeW + (ids.length - 1) * xGap;
    const startX = (totalW - rowWidth) / 2;
    const y = pad + i * (nodeH + yGap);

    ids.forEach((id, idx) => {
      const x = startX + idx * (nodeW + xGap);
      positions.set(id, { x, y });
    });
  }

  const edgeLayer = makeSvgEl('g');
  const nodeLayer = makeSvgEl('g');

  const drawLabeledEdge = (d, label) => {
    const path = makeSvgEl('path', {
      d,
      class: 'edge',
      stroke: '#ffffff',
      opacity: 0.9,
    });
    edgeLayer.appendChild(path);
    const mid = path.getPointAtLength(path.getTotalLength() / 2);

    const labelGroup = makeSvgEl('g', { class: 'edge-label-chip' });
    const t = makeSvgEl('text', {
      x: mid.x,
      y: mid.y,
      class: 'edge label',
      fill: '#ffffff',
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
    });
    t.textContent = label;
    labelGroup.appendChild(t);
    edgeLayer.appendChild(labelGroup);
  };

  const getBoxAnchorPair = (a, b) => {
    const ac = { x: a.x + nodeW / 2, y: a.y + nodeH / 2 };
    const bc = { x: b.x + nodeW / 2, y: b.y + nodeH / 2 };
    const dx = bc.x - ac.x;
    const dy = bc.y - ac.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (dx >= 0) {
        return {
          start: { x: a.x + nodeW, y: ac.y },
          end: { x: b.x, y: bc.y },
        };
      }
      return {
        start: { x: a.x, y: ac.y },
        end: { x: b.x + nodeW, y: bc.y },
      };
    }

    if (dy >= 0) {
      return {
        start: { x: ac.x, y: a.y + nodeH },
        end: { x: bc.x, y: b.y },
      };
    }
    return {
      start: { x: ac.x, y: a.y },
      end: { x: bc.x, y: b.y + nodeH },
    };
  };

  const spouseRelations = state.relations.filter((r) => r.type === 'spouse');
  const parentRelations = state.relations.filter((r) => r.type === 'parent');

  const spousePairKeys = new Set();
  for (const r of spouseRelations) spousePairKeys.add([r.from, r.to].sort().join(':'));

  const parentRelationsByChild = new Map();
  for (const r of parentRelations) {
    if (!parentRelationsByChild.has(r.to)) parentRelationsByChild.set(r.to, []);
    parentRelationsByChild.get(r.to).push(r);
  }

  const mergedParentRelationIds = new Set();
  const commonChildrenByPair = new Map();
  for (const [childId, relations] of parentRelationsByChild.entries()) {
    let matchedPairKey = null;
    let matchedIds = null;
    for (let i = 0; i < relations.length; i += 1) {
      for (let j = i + 1; j < relations.length; j += 1) {
        const pairKey = [relations[i].from, relations[j].from].sort().join(':');
        if (!spousePairKeys.has(pairKey)) continue;
        matchedPairKey = pairKey;
        matchedIds = [relations[i].id, relations[j].id];
        break;
      }
      if (matchedPairKey) break;
    }
    if (!matchedPairKey) continue;
    mergedParentRelationIds.add(matchedIds[0]);
    mergedParentRelationIds.add(matchedIds[1]);
    if (!commonChildrenByPair.has(matchedPairKey)) commonChildrenByPair.set(matchedPairKey, new Set());
    commonChildrenByPair.get(matchedPairKey).add(childId);
  }

  for (const r of spouseRelations) {
    const a = positions.get(r.from);
    const b = positions.get(r.to);
    if (!a || !b) continue;

    const anchors = getBoxAnchorPair(a, b);
    const x1 = anchors.start.x;
    const y1 = anchors.start.y;
    const x2 = anchors.end.x;
    const y2 = anchors.end.y;
    const pairKey = [r.from, r.to].sort().join(':');
    const commonChildren = [...(commonChildrenByPair.get(pairKey) || [])];
    const spouseD = `M ${x1} ${y1} L ${x2} ${y2}`;
    drawLabeledEdge(spouseD, '配偶');

    if (commonChildren.length === 0) continue;

    const childrenPos = commonChildren
      .map((id) => positions.get(id))
      .filter(Boolean)
      .sort((p1, p2) => (p1.x + nodeW / 2) - (p2.x + nodeW / 2));
    if (childrenPos.length === 0) continue;

    const midX = (x1 + x2) / 2;
    const spouseY = (y1 + y2) / 2;
    const childTopY = Math.min(...childrenPos.map((p) => p.y));
    const childBarY = Math.max(spouseY + 22, childTopY - 28);

    const trunk = `M ${midX} ${spouseY} L ${midX} ${childBarY}`;
    drawLabeledEdge(trunk, '亲子');

    // Always connect spouse trunk to child branch bar, including single-child cases.
    const childCenters = childrenPos.map((p) => p.x + nodeW / 2);
    const barLeft = Math.min(midX, ...childCenters);
    const barRight = Math.max(midX, ...childCenters);
    if (barRight > barLeft) {
      edgeLayer.appendChild(makeSvgEl('path', {
        d: `M ${barLeft} ${childBarY} L ${barRight} ${childBarY}`,
        class: 'edge',
        stroke: '#ffffff',
        opacity: 0.9,
      }));
    }

    for (const cp of childrenPos) {
      const cx = cp.x + nodeW / 2;
      const topY = cp.y;
      edgeLayer.appendChild(makeSvgEl('path', {
        d: `M ${cx} ${childBarY} L ${cx} ${topY}`,
        class: 'edge',
        stroke: '#ffffff',
        opacity: 0.9,
      }));
    }
  }

  for (const r of parentRelations) {
    if (mergedParentRelationIds.has(r.id)) continue;
    const p = positions.get(r.from);
    const c = positions.get(r.to);
    if (!p || !c) continue;
    const x1 = p.x + nodeW / 2;
    const y1 = p.y + nodeH;
    const x2 = c.x + nodeW / 2;
    const y2 = c.y;
    const midY = y1 + (y2 - y1) / 2;
    const d = `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    drawLabeledEdge(d, '亲子');
  }

  for (const person of state.people) {
    const pos = positions.get(person.id);
    if (!pos) continue;
    const g = makeSvgEl('g', { class: state.selectedPersonId === person.id ? 'node selected' : 'node' });
    g.style.cursor = 'pointer';

    g.appendChild(makeSvgEl('rect', {
      x: pos.x,
      y: pos.y,
      width: nodeW,
      height: nodeH,
      fill: nodeColor(person.gender),
      stroke: 'rgba(227, 245, 255, 0.8)',
    }));

    const avatarCx = pos.x + 24;
    const avatarCy = pos.y + nodeH / 2;
    const avatarR = 17;
    g.appendChild(makeSvgEl('circle', {
      cx: avatarCx,
      cy: avatarCy,
      r: avatarR + 1,
      fill: 'rgba(4, 14, 23, 0.65)',
      stroke: 'rgba(227, 245, 255, 0.7)',
      'stroke-width': 1,
    }));
    if (person.avatar) {
      const clipId = `avatar-clip-${person.id}`;
      const clipPath = makeSvgEl('clipPath', { id: clipId });
      clipPath.appendChild(makeSvgEl('circle', { cx: avatarCx, cy: avatarCy, r: avatarR }));
      g.appendChild(clipPath);
      g.appendChild(makeSvgEl('image', {
        href: person.avatar,
        x: avatarCx - avatarR,
        y: avatarCy - avatarR,
        width: avatarR * 2,
        height: avatarR * 2,
        'clip-path': `url(#${clipId})`,
        preserveAspectRatio: 'xMidYMid slice',
      }));
    } else {
      const initial = makeSvgEl('text', {
        x: avatarCx,
        y: avatarCy + 1,
        'font-size': 11,
        'font-weight': 700,
        fill: '#d0edf9',
      });
      initial.textContent = person.name.slice(0, 1);
      g.appendChild(initial);
    }

    const name = makeSvgEl('text', {
      x: pos.x + 98,
      y: pos.y + 25,
      'font-size': 14,
      'font-weight': 700,
      'text-anchor': 'middle',
    });
    name.textContent = person.name;
    g.appendChild(name);

    const meta = makeSvgEl('text', {
      x: pos.x + 98,
      y: pos.y + 45,
      'font-size': 11,
      fill: '#e3f5ff',
      opacity: 0.9,
      'text-anchor': 'middle',
    });
    const hasBirth = person.birth !== null && person.birth !== undefined && person.birth !== '';
    const birth = hasBirth ? String(person.birth) : '';
    meta.textContent = birth && person.note ? `${birth} · ${person.note}` : (birth || person.note || '');
    g.appendChild(meta);

    g.addEventListener('click', (e) => {
      e.stopPropagation();
      state.selectedPersonId = state.selectedPersonId === person.id ? null : person.id;
      hideRelationHint();
      drawTree();
    });
    g.addEventListener('mouseenter', (evt) => {
      if (!state.selectedPersonId || state.selectedPersonId === person.id) {
        hideRelationHint();
        return;
      }
      const text = pairRelationText(state.selectedPersonId, person.id);
      if (text) showRelationHint(text, evt);
      else hideRelationHint();
    });
    g.addEventListener('mousemove', (evt) => {
      if (relationHint.style.display !== 'none') updateRelationHintPosition(evt);
    });
    g.addEventListener('mouseleave', hideRelationHint);

    nodeLayer.appendChild(g);
  }

  treeSvg.appendChild(edgeLayer);
  treeSvg.appendChild(nodeLayer);
}

function persistAndRender() {
  dedupeRelations();
  sanitizeRelations();
  ensureManualOrder();
  if (state.selectedPersonId && !getPersonById(state.selectedPersonId)) state.selectedPersonId = null;
  hideRelationHint();
  saveState();
  renderPersonOptions();
  renderPeopleList();
  renderRelationList();
  drawTree();
  stats.textContent = `人物 ${state.people.length} · 关系 ${state.relations.length}`;
}

personForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = personNameInput.value.trim();
  if (!name) return;

  const birthRaw = personBirthInput.value.trim();
  const payload = {
    name,
    gender: personGenderInput.value,
    birth: birthRaw ? Number(birthRaw) : null,
    note: personNoteInput.value.trim(),
    avatar: personAvatarInput.value.trim(),
  };

  if (state.editingPersonId) {
    const p = getPersonById(state.editingPersonId);
    if (p) Object.assign(p, payload);
  } else {
    const maxOrder = state.people.reduce((m, p) => Math.max(m, p.manualOrder ?? -1), -1);
    state.people.push({ id: uid(), ...payload, manualOrder: maxOrder + 1 });
  }

  clearPersonForm();
  persistAndRender();
});

cancelEditBtn.addEventListener('click', clearPersonForm);

personAvatarFileInput.addEventListener('change', () => {
  const file = personAvatarFileInput.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    const src = typeof reader.result === 'string' ? reader.result : '';
    personAvatarInput.value = src;
    setAvatarPreview(src);
  };
  reader.readAsDataURL(file);
});

clearAvatarBtn.addEventListener('click', () => {
  personAvatarInput.value = '';
  personAvatarFileInput.value = '';
  setAvatarPreview('');
});

treeSvg.addEventListener('click', () => {
  if (!state.selectedPersonId) return;
  state.selectedPersonId = null;
  hideRelationHint();
  drawTree();
});

relationForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const from = fromIdInput.value;
  const to = toIdInput.value;
  const type = relationTypeInput.value;
  if (!from || !to || from === to || !type) return;

  state.relations.push({ id: uid(), from, to, type });
  persistAndRender();
  relationForm.reset();
});

seedBtn.addEventListener('click', () => {
  state.people = [
    { id: 'p1', name: '李建国', gender: 'male', birth: 1965, note: '', avatar: '', manualOrder: 0 },
    { id: 'p2', name: '王秀兰', gender: 'female', birth: 1967, note: '', avatar: '', manualOrder: 1 },
    { id: 'p3', name: '李明', gender: 'male', birth: 1990, note: '长子', avatar: '', manualOrder: 2 },
    { id: 'p4', name: '李婷', gender: 'female', birth: 1993, note: '次女', avatar: '', manualOrder: 3 },
    { id: 'p5', name: '张蕾', gender: 'female', birth: 1991, note: '', avatar: '', manualOrder: 4 },
    { id: 'p6', name: '李小宇', gender: 'male', birth: 2020, note: '', avatar: '', manualOrder: 5 },
  ];
  state.relations = [
    { id: uid(), from: 'p1', to: 'p2', type: 'spouse' },
    { id: uid(), from: 'p1', to: 'p3', type: 'parent' },
    { id: uid(), from: 'p2', to: 'p3', type: 'parent' },
    { id: uid(), from: 'p1', to: 'p4', type: 'parent' },
    { id: uid(), from: 'p2', to: 'p4', type: 'parent' },
    { id: uid(), from: 'p3', to: 'p5', type: 'spouse' },
    { id: uid(), from: 'p3', to: 'p6', type: 'parent' },
    { id: uid(), from: 'p5', to: 'p6', type: 'parent' },
    { id: uid(), from: 'p3', to: 'p4', type: 'sibling' },
  ];
  clearPersonForm();
  persistAndRender();
});

resetBtn.addEventListener('click', () => {
  state.people = [];
  state.relations = [];
  clearPersonForm();
  persistAndRender();
});

exportBtn.addEventListener('click', async () => {
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(treeSvg);
  const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    const vb = treeSvg.viewBox.baseVal;
    const width = vb.width || treeSvg.clientWidth || 1200;
    const height = vb.height || treeSvg.clientHeight || 800;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, '#07141e');
    g.addColorStop(1, '#02070b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, width, height);

    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);

    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
    a.download = `family-tree-${stamp}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  img.src = url;
});

loadState();
persistAndRender();
