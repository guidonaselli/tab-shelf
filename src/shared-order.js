export function reconcileOrder(order, tabs) {
  const ids = new Set(tabs.map((tab) => tab.id));
  return [...new Set([...order.filter((id) => ids.has(id)), ...tabs.map((tab) => tab.id)])];
}

export function moveInOrder(order, id, beforeId) {
  if (!order.includes(id) || (beforeId !== null && !order.includes(beforeId)) || id === beforeId) return order;
  const next = order.filter((item) => item !== id);
  next.splice(beforeId === null ? next.length : next.indexOf(beforeId), 0, id);
  return next;
}
