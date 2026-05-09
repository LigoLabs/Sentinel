export interface ToastMessage {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

let toasts = $state<ToastMessage[]>([]);
let nextId = 0;

function add(type: ToastMessage['type'], message: string, duration = 4000) {
  const id = nextId++;
  toasts = [...toasts, { id, type, message }];
  setTimeout(() => remove(id), duration);
}

function remove(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
}

export const toast = {
  get items() { return toasts; },
  success: (msg: string) => add('success', msg),
  error: (msg: string) => add('error', msg),
  info: (msg: string) => add('info', msg),
  remove,
};
