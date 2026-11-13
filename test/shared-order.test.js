import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileOrder, moveInOrder } from '../src/shared-order.js';

test('reconcileOrder conserva el orden compartido entre ventanas', () => {
  const tabs = [{ id: 1, windowId: 10 }, { id: 2, windowId: 10 }, { id: 3, windowId: 20 }];
  assert.deepEqual(reconcileOrder([3, 1, 2], tabs), [3, 1, 2]);
});

test('reconcileOrder elimina pestañas cerradas sin reordenar las restantes', () => {
  assert.deepEqual(reconcileOrder([3, 1, 2, 4], [{ id: 2 }, { id: 3 }]), [3, 2]);
});

test('reconcileOrder agrega pestañas nuevas en el orden recibido', () => {
  assert.deepEqual(reconcileOrder([3, 1], [{ id: 2 }, { id: 1 }, { id: 4 }, { id: 3 }]), [3, 1, 2, 4]);
});

test('reconcileOrder elimina duplicados del orden y de las pestañas recibidas', () => {
  assert.deepEqual(reconcileOrder([3, 3, 1, 1], [{ id: 1 }, { id: 2 }, { id: 2 }, { id: 3 }]), [3, 1, 2]);
});

test('reconcileOrder inicia el orden cuando la lista guardada está vacía', () => {
  assert.deepEqual(reconcileOrder([], [{ id: 2 }, { id: 1 }]), [2, 1]);
});

test('reconcileOrder devuelve un orden vacío cuando no quedan pestañas', () => {
  assert.deepEqual(reconcileOrder([2, 1], []), []);
});

test('reconcileOrder no modifica el orden recibido', () => {
  const order = [3, 1, 2];
  const result = reconcileOrder(order, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual([result, order], [[1, 2], [3, 1, 2]]);
});

test('moveInOrder mueve una pestaña antes de otra hacia el inicio', () => {
  assert.deepEqual(moveInOrder([1, 2, 3, 4], 4, 2), [1, 4, 2, 3]);
});

test('moveInOrder mueve una pestaña antes de otra hacia el final', () => {
  assert.deepEqual(moveInOrder([1, 2, 3, 4], 1, 4), [2, 3, 1, 4]);
});

test('moveInOrder mueve una pestaña al final con destino null', () => {
  assert.deepEqual(moveInOrder([1, 2, 3], 1, null), [2, 3, 1]);
});

test('moveInOrder conserva el orden al mover una pestaña sobre sí misma', () => {
  assert.deepEqual(moveInOrder([1, 2, 3], 2, 2), [1, 2, 3]);
});

test('moveInOrder ignora un ID desconocido', () => {
  assert.deepEqual(moveInOrder([1, 2, 3], 9, 2), [1, 2, 3]);
});

test('moveInOrder ignora un destino desconocido', () => {
  assert.deepEqual(moveInOrder([1, 2, 3], 1, 9), [1, 2, 3]);
});

test('moveInOrder ignora un ID ausente', () => {
  assert.deepEqual(moveInOrder([1, 2, 3], undefined, 2), [1, 2, 3]);
});

test('moveInOrder ignora un destino ausente', () => {
  assert.deepEqual(moveInOrder([1, 2, 3], 1, undefined), [1, 2, 3]);
});

test('moveInOrder conserva un orden vacío', () => {
  assert.deepEqual(moveInOrder([], 1, null), []);
});

test('moveInOrder no modifica el orden recibido', () => {
  const order = [1, 2, 3];
  const result = moveInOrder(order, 3, 1);
  assert.deepEqual([result, order], [[3, 1, 2], [1, 2, 3]]);
});
