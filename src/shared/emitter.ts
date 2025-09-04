export type Listener<T extends Array<unknown>, R = unknown> = (
	...arguments_: T
) => R;
export type ForceArray<T> = T extends Array<unknown> ? T : [T];

class Emitter<T> {
	private on_callbacks: Array<{
		name: keyof T;
		callback: Listener<ForceArray<T[keyof T]>, unknown>[];
	}> = [];

	private once_callbacks: Array<{
		name: keyof T;
		callback: Listener<ForceArray<T[keyof T]>, unknown>[];
	}> = [];

	public on<K extends keyof T>(
		name: K,
		callback: Listener<ForceArray<T[K]>, unknown>,
	) {
		const existing = this.on_callbacks.find((cb) => cb.name === name);
		if (existing) {
			existing.callback.push(
				callback as Listener<ForceArray<T[keyof T]>, unknown>,
			);
		} else {
			this.on_callbacks.push({
				name,
				callback: [callback as Listener<ForceArray<T[keyof T]>, unknown>],
			});
		}
	}

	public once<K extends keyof T>(
		name: K,
		callback: Listener<ForceArray<T[K]>, unknown>,
	) {
		const existing = this.once_callbacks.find((cb) => cb.name === name);
		if (existing) {
			existing.callback.push(
				callback as Listener<ForceArray<T[keyof T]>, unknown>,
			);
		} else {
			this.once_callbacks.push({
				name,
				callback: [callback as Listener<ForceArray<T[keyof T]>, unknown>],
			});
		}
	}

	public emit<K extends keyof T>(name: K, ...args: ForceArray<T[K]>) {
		for (let i = 0; i < this.on_callbacks.length; i++) {
			const entry = this.on_callbacks[i];
			if (entry.name === name) {
				const callbacks = [...entry.callback];
				for (const cb of callbacks) {
					cb(...args);
				}
			}
		}

		const onceEntries = this.once_callbacks.filter(
			(entry) => entry.name === name,
		);
		this.once_callbacks = this.once_callbacks.filter(
			(entry) => !onceEntries.includes(entry),
		);
		for (const entry of onceEntries) {
			const callbacks = [...entry.callback];
			for (const cb of callbacks) {
				cb(...args);
			}
		}
	}

	public removeListener<K extends keyof T>(
		name: K,
		_callback: Listener<ForceArray<T[K]>, unknown>,
	) {
		const existing = this.on_callbacks.find((cb) => cb.name === name);
		if (existing) {
			existing.callback = existing.callback.filter((cb) => cb !== _callback);
			if (existing.callback.length === 0) {
				this.on_callbacks = this.on_callbacks.filter((cb) => cb !== existing);
			}
		}
	}

	public removeAllListeners(name: keyof T | undefined = undefined) {
		if (name) {
			this.on_callbacks = this.on_callbacks.filter(
				(callback) => callback.name !== name,
			);
			this.once_callbacks = this.once_callbacks.filter(
				(callback) => callback.name !== name,
			);
		} else {
			this.on_callbacks = [];
			this.once_callbacks = [];
		}
	}

	public hasListeners(name: keyof T) {
		return (
			this.on_callbacks.some((cb) => cb.name === name) ||
			this.once_callbacks.some((cb) => cb.name === name)
		);
	}

	public destroy() {
		this.on_callbacks = [];
		this.once_callbacks = [];
	}
}

export { Emitter };
