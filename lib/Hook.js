/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/
"use strict";

// nodejs原生的util模块
const util = require("util");

const deprecateContext = util.deprecate(() => {
	},
	"Hook.context is deprecated and will be removed");

const CALL_DELEGATE = function (...args) {
	this.call = this._createCall("sync");
	return this.call(...args);
};
const CALL_ASYNC_DELEGATE = function (...args) {
	this.callAsync = this._createCall("async");
	return this.callAsync(...args);
};
const PROMISE_DELEGATE = function (...args) {
	this.promise = this._createCall("promise");
	return this.promise(...args);
};

/**
 * 可以向Hook钩子容器中添加任意多的钩子，这些钩子作为统一的数据源，而这些钩子具体的调用方式分为：call、callAsync和promise，真正的call、callAsync和promise
 * 又是通过compile函数获得的，所以compile函数中可以定义三种类型的调用方式如何处理。
 */
class Hook {
	constructor(args = [], name = undefined) {
		this._args = args;
		this.name = name;
		// 存放所有已添加的钩子的选项对象
		this.taps = [];
		/**
		 * 拦截器，会在绑定钩子时依次调用，可用于更新钩子的选项对象，其内部数据结构为：
		 * {
		 *   register: Function, // 注册钩子时，对钩子的选项对象进行处理的函数，同时，在注册拦截器时，也会调用该拦截器的register，可查看intercept方法
		 *   call: Function, //
		 *   context: any, // Todo 从代码上来看，感觉没啥大作用
		 *   tap: Function, // 在调用钩子之前被调用的函数，参数为钩子选项对象
		 * }
		 */
		this.interceptors = [];
		// 同步调用的默认函数，主要用于初始化this.call
		this._call = CALL_DELEGATE;
		this.call = CALL_DELEGATE;
		// 异步调用的默认函数，主要用于初始化this.callAsync
		this._callAsync = CALL_ASYNC_DELEGATE;
		this.callAsync = CALL_ASYNC_DELEGATE;
		// 主要用于初始化this.promise
		this._promise = PROMISE_DELEGATE;
		// Todo promise与callAsync的区别是什么？
		this.promise = PROMISE_DELEGATE;
		this._x = undefined;

		this.compile = this.compile;
		this.tap = this.tap;
		this.tapAsync = this.tapAsync;
		this.tapPromise = this.tapPromise;
	}

	/**
	 * Todo 创建call调用的编译器，会返回一个函数？？？猜测：该函数用于根据options生成不同类型的调用函数，以操作统一的数据源taps
	 * 每次调用call等函数之前，都会调用该方法，因为这个方法用于生成真正调用的call
	 * @param options
	 */
	compile(options) {
		throw new Error("Abstract: should be overridden");
	}

	_createCall(type) {
		return this.compile({
			taps: this.taps,
			interceptors: this.interceptors,
			args: this._args,
			type: type
		});
	}

	/**
	 * 绑定钩子选项
	 *
	 * @param type
	 * @param options 选项对象，数据结构为：
	 * {
	 *   type: String, //
	 *   fn: Function, // 当钩子被调用时，真正执行的函数
	 *   // 当选项对象插入taps数组中时，如果taps中已有选项对象，则before用于表示当前选项对象必须在对应的已有的选项对象之前，比如伪代码为：
	 *   // taps = [{name:'hello'}, {name: 'world'}, {name: 'why'}];
	 *   // newHook = {name: 'go', before: 'world'}
	 *   // 插入之后为[{name:'hello'}, {name: 'go', before: 'world'}, {name: 'world'}, {name: 'why'}]
	 *   before: String | Array,
	 *   stage: Number, // 与before类似，用于指定插入到taps中的选项对象的顺序，按照从小到大的顺序排列，局部有序。优先级比before低，详情可查看_insert方法中注释
	 * }
	 * @param fn
	 * @private
	 */
	_tap(type, options, fn) {
		if (typeof options === "string") {
			options = {
				name: options
			};
		} else if (typeof options !== "object" || options === null) {
			throw new Error("Invalid tap options");
		}
		if (typeof options.name !== "string" || options.name === "") {
			throw new Error("Missing name for tap");
		}
		if (typeof options.context !== "undefined") {
			deprecateContext();
		}
		options = Object.assign({type, fn}, options);
		options = this._runRegisterInterceptors(options);
		this._insert(options);
	}

	tap(options, fn) {
		this._tap("sync", options, fn);
	}

	tapAsync(options, fn) {
		this._tap("async", options, fn);
	}

	tapPromise(options, fn) {
		this._tap("promise", options, fn);
	}

	/**
	 * 运行拦截器中的register回调函数
	 * @param options
	 */
	_runRegisterInterceptors(options) {
		for (const interceptor of this.interceptors) {
			if (interceptor.register) {
				// 通过拦截器的register函数对钩子的选项对象进行处理，返回的选项对象会覆盖之前的选项
				const newOptions = interceptor.register(options);
				if (newOptions !== undefined) {
					options = newOptions;
				}
			}
		}
		return options;
	}

	withOptions(options) {
		const mergeOptions = opt =>
			Object.assign({}, options, typeof opt === "string" ? {name: opt} : opt);

		return {
			name: this.name,
			tap: (opt, fn) => this.tap(mergeOptions(opt), fn),
			tapAsync: (opt, fn) => this.tapAsync(mergeOptions(opt), fn),
			tapPromise: (opt, fn) => this.tapPromise(mergeOptions(opt), fn),
			intercept: interceptor => this.intercept(interceptor),
			isUsed: () => this.isUsed(),
			withOptions: opt => this.withOptions(mergeOptions(opt))
		};
	}

	isUsed() {
		return this.taps.length > 0 || this.interceptors.length > 0;
	}

	/**
	 * 注册拦截器
	 * @param interceptor
	 */
	intercept(interceptor) {
		this._resetCompilation();
		this.interceptors.push(Object.assign({}, interceptor));
		if (interceptor.register) {
			for (let i = 0; i < this.taps.length; i++) {
				// Todo 感觉这里的代码有问题，无法与_runRegisterInterceptors方法中运行拦截器的行为一致，在
				// 			_runRegisterInterceptors方法中，interceptor.register方法的返回值会进行一次判断，但是这里没有，行为不一致。
				this.taps[i] = interceptor.register(this.taps[i]);
			}
		}
	}

	// Todo 为什么要重置？
	_resetCompilation() {
		this.call = this._call;
		this.callAsync = this._callAsync;
		this.promise = this._promise;
	}

	/**
	 * 将钩子的选项对象插入taps数组中，插入时，会根据item中的before和stage参数决定插入的位置
	 * @param item
	 * @private
	 */
	_insert(item) {
		this._resetCompilation();

		let before;

		if (typeof item.before === "string") {
			before = new Set([item.before]);
		} else if (Array.isArray(item.before)) {
			before = new Set(item.before);
		}

		let stage = 0;

		if (typeof item.stage === "number") {
			stage = item.stage;
		}

		let i = this.taps.length;

		while (i > 0) {
			i--;
			const x = this.taps[i];
			// 将x在taps数组中向后移动一位，但是i的位置仍然是x，也就是说，当前i和i + 1的位置都是x选项对象
			this.taps[i + 1] = x;
			const xStage = x.stage || 0;

			// before用于指定新插入的钩子放置到哪个或哪些钩子之前，与name属性进行比较
			if (before) {
				if (before.has(x.name)) {
					before.delete(x.name);
					continue;
				}
				// 如果before中存在数据，则继续在taps中向前移动
				if (before.size > 0) {
					continue;
				}
			}

			// 根据每个选项的stage在局部区域内由小到大排序
			// 为什么说是局部区域内？因为before的优先级比stage的优先级高，before会强制将钩子选项对象置于某个或某些钩子之前
			// 比如在taps数组中，stage值可能的数列为：1 3 8 5 7 10
			// 再就是，如果两个选项的stage相同，则之后加入的选项对象在之前加入的选项对象之后
			if (xStage > stage) {
				continue;
			}

			// item对应的选项对象应放置到x对应的选项对象之后，所以需要i++，注意，在i和i + 1的位置上都是x对应的选项对象，i++就是放置到i + 1的位置，也就是x之后
			i++;
			break;
		}
		this.taps[i] = item;
	}
}

Object.setPrototypeOf(Hook.prototype, null);

module.exports = Hook;
