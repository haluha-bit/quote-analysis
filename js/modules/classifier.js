/* ================================================================
   Classifier — Production Line & Equipment Tag UI
================================================================ */

import { lineService }       from '../services/lineService.js';
import { showToast }         from '../ui/notifications.js';
import { buildLineConfigItem } from '../ui/components.js';

let _selectedLine      = null;  // { id, name }
let _selectedEquipment = [];    // string[]

/** Return currently selected tags */
export function getSelectedTags() {
  return { line: _selectedLine, equipment: [..._selectedEquipment] };
}

/** Reset all selections */
export function resetTags() {
  _selectedLine      = null;
  _selectedEquipment = [];
  document.querySelectorAll('.line-chip, .equipment-chip').forEach(el => el.classList.remove('selected'));
  const eqSection = document.getElementById('equipment-section');
  if (eqSection) eqSection.style.display = 'none';
}

/** Render line chips inside #line-chips */
async function renderLineChips() {
  const container = document.getElementById('line-chips');
  if (!container) return;

  const lines = await lineService.getAll();
  container.innerHTML = '';

  lines.forEach(line => {
    const chip = document.createElement('span');
    chip.className   = 'line-chip';
    chip.textContent = line.name;
    chip.dataset.id  = line.id;

    chip.addEventListener('click', () => {
      document.querySelectorAll('.line-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      _selectedLine      = { id: line.id, name: line.name };
      _selectedEquipment = [];
      renderEquipmentChips(line);
    });

    container.appendChild(chip);
  });
}

/** Render equipment chips for selected line */
function renderEquipmentChips(line) {
  const section   = document.getElementById('equipment-section');
  const container = document.getElementById('equipment-chips');
  if (!section || !container) return;

  section.style.display = 'block';
  container.innerHTML   = '';

  line.equipment.forEach(eq => {
    const chip = document.createElement('span');
    chip.className   = 'equipment-chip';
    chip.textContent = eq;

    chip.addEventListener('click', () => {
      chip.classList.toggle('selected');
      if (chip.classList.contains('selected')) {
        _selectedEquipment.push(eq);
      } else {
        _selectedEquipment = _selectedEquipment.filter(e => e !== eq);
      }
    });

    container.appendChild(chip);
  });
}

/** Render lines config list in settings view */
async function renderLinesConfig() {
  const listEl = document.getElementById('lines-config-list');
  if (!listEl) return;

  const lines = await lineService.getAll();
  listEl.innerHTML = '';
  lines.forEach(line => {
    const item = buildLineConfigItem(line, _handleEditLine, _handleDeleteLine);
    listEl.appendChild(item);
  });
}

async function _handleEditLine(line) {
  const newName = prompt(`编辑产线名称（当前：${line.name}）`, line.name);
  if (!newName || newName.trim() === line.name) return;
  try {
    await lineService.update(line.id, { ...line, name: newName.trim() });
    showToast(`产线 "${newName.trim()}" 已更新`, 'success');
    renderLinesConfig();
    renderLineChips();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function _handleDeleteLine(line) {
  if (!confirm(`确定要删除产线 "${line.name}" 吗？`)) return;
  try {
    await lineService.remove(line.id);
    showToast(`产线 "${line.name}" 已删除`, 'success');
    renderLinesConfig();
    renderLineChips();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function _handleAddLine() {
  const name = prompt('新增产线名称：');
  if (!name?.trim()) return;
  const id = name.trim().replace(/\s+/g, '_').toUpperCase();
  try {
    await lineService.add({ id, name: name.trim(), equipment: [] });
    showToast(`产线 "${name.trim()}" 已新增`, 'success');
    renderLinesConfig();
    renderLineChips();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/** Initialize classifier: render chips, wire settings buttons */
export async function initClassifier() {
  await renderLineChips();
  await renderLinesConfig();

  document.getElementById('btn-add-line')?.addEventListener('click', _handleAddLine);
}
