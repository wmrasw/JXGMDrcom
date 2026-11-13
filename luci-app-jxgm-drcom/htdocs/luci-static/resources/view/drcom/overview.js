/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 wmrasw
 */
'use strict';
'require view';
'require form';
'require fs';
'require rpc';
'require uci';
'require tools.widgets as widgets';
'require ui';
'require poll';

var STATEFILE = '/var/run/drcom.state';
var SCRIPT = '/usr/share/drcom/drcom.sh';

// Keep in sync with PKG_VERSION in the Makefile; the CI build fails if they
// disagree, because the about dialog reads this constant.
var PKG_VERSION = '1.0.3';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { 'drcom': {} }
});

// rpc.declare() with expect: { 'drcom': {} } already unwraps the reply down
// to the service entry, so this receives { instances: ... } directly and not
// { drcom: { instances: ... } }.
function isRunning(entry) {
	var instances = (entry && entry.instances) || {};

	// procd keeps a failed instance entry around, so presence alone is not
	// enough: require a live process.
	return Object.keys(instances).some(function(name) {
		var inst = instances[name] || {};

		return inst.running === true ||
			(typeof(inst.pid) == 'number' && inst.pid > 0);
	});
}

function parseState(text) {
	var out = {};

	String(text || '').split('\n').forEach(function(line) {
		var eq = line.indexOf('=');

		if (eq > 0)
			out[line.substring(0, eq)] = line.substring(eq + 1);
	});

	return out;
}

function formatLast(st) {
	var msg = st.message || '';
	var ts = st.last_login ? formatTime(st.last_login) : '';

	if (st.status === 'online' && ts && msg)
		return msg + ' · ' + _('上次登录') + ' ' + ts;

	return msg || ts || '—';
}

function formatTime(ts) {
	var n = parseInt(ts, 10);

	if (!n)
		return _('从未');

	return new Date(n * 1000).toLocaleString();
}

function escapeHtml(s) {
	return String(s).replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function pad2(n) {
	return ('0' + n).slice(-2);
}

function fmtDuration(sec) {
	var d = Math.floor(sec / 86400);
	var h = Math.floor(sec / 3600) % 24;
	var m = Math.floor(sec / 60) % 60;
	var s = sec % 60;

	if (d > 0)
		return d + 'd ' + pad2(h) + ':' + pad2(m);

	return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
}

function fmtTraffic(kb) {
	if (kb >= 1048576)
		return (kb / 1048576).toFixed(1) + ' GB';

	if (kb >= 1024)
		return (kb / 1024).toFixed(1) + ' MB';

	return kb + ' KB';
}

function badgeState(running, st) {
	var paused = running && st && st.status === 'config-error';

	return {
		paused: paused,
		cls: running && !paused ? 'success' : 'warning',
		text: paused ? _('已暂停') : (running ? _('运行中') : _('已停止'))
	};
}

function badgeHtml(running, st) {
	var b = badgeState(running, st);

	return '<span id="drcom-service-state" class="label %s">%s</span>'
		.format(b.cls, b.text);
}

function runInit(action) {
	return fs.exec('/etc/init.d/drcom', [ action ]).then(function(res) {
		if (res.code != 0)
			throw new Error(res.stderr || _('命令执行失败（退出码 %d）。').format(res.code));

		var label = {
			start: _('启动'),
			restart: _('重启'),
			stop: _('停止')
		}[action] || action;

		ui.addNotification(null, E('p',
			_('操作“%s”完成。').format(label)), 'info');
	}).catch(function(err) {
		ui.addNotification(null, E('p', String(err.message || err)), 'danger');
	});
}

var probeState = { text: '—' };
var macState = { text: '' };
var ipState = { text: '—' };
var sessionState = { text: '—' };
var probeSeq = 0;
var probeTimer = null;

// 输入框是 change 事件触发，但部分浏览器对 value 控件会连发，
// 这里加 400ms 去抖 + 序号防乱序。
function scheduleProbe(url) {
	window.clearTimeout(probeTimer);
	probeTimer = window.setTimeout(function() {
		checkProbe(url);
	}, 400);
}

function checkProbe(url) {
	var el = document.getElementById('drcom-probe');
	var target = String(url || '').trim();
	var seq = ++probeSeq;

	if (!target) {
		probeState.text = _('未填写');
		if (el) el.textContent = probeState.text;
		return Promise.resolve();
	}

	probeState.text = _('检测中…');
	if (el) el.textContent = probeState.text;

	return fs.exec(SCRIPT, [ 'probe', target ]).then(function(res) {
		if (seq !== probeSeq)
			return;

		var code = String(res.stdout || '').trim();
		var ok = (res.code == 0 && code === '204');
		var shown = (!code || code === '000') ? _('无响应') : code;

		probeState.text = ok ? _('可用（HTTP 204）')
			: _('不可用（%s）').format(shown);

		if (el)
			el.textContent = probeState.text;

	}).catch(function(err) {
		probeState.text = _('检测失败');
		if (el) el.textContent = probeState.text;
		ui.addNotification(null, E('p', String(err.message || err)), 'danger');
	});
}

function syncMacDom() {
	var el = document.getElementById('drcom-real-mac');

	if (el) {
		el.textContent = macState.text;
		return true;
	}

	return false;
}

function syncIpDom() {
	var el = document.getElementById('drcom-uplink-ip');

	if (el) {
		el.textContent = ipState.text;
		return true;
	}

	return false;
}

function refreshUplinkIp() {
	var apply = function(text) {
		ipState.text = text;
		if (!syncIpDom())
			window.setTimeout(syncIpDom, 800);
	};

	return fs.exec(SCRIPT, [ 'ip' ]).then(function(res) {
		apply(String(res.stdout || '').trim() || _('未知'));
	}).catch(function() {
		apply(_('未知'));
	});
}

function refreshRealMac() {
	var apply = function(text) {
		macState.text = text;
		if (!syncMacDom())
			window.setTimeout(syncMacDom, 800);
	};

	return fs.exec(SCRIPT, [ 'mac' ]).then(function(res) {
		apply(String(res.stdout || '').trim() || _('未知'));
	}).catch(function() {
		apply(_('未知'));
	});
}

function applyMac(mac) {
	return fs.exec(SCRIPT, [ 'set-mac', mac ]).then(function(res) {
		var out = String(res.stdout || '').trim();

		var parts = out.split(/\s+/);

		if (res.code == 0 && parts[0] === 'ok') {
			ui.addNotification(null, E('p',
				_('上行端口 %s 的 MAC 已修改，网络会短暂重连。').format(parts[1] || _('(未知)'))), 'info');
			window.setTimeout(refreshRealMac, 3000);
		}
		else {
			ui.addNotification(null, E('p',
				_('修改失败：%s').format(out || res.code)), 'danger');
		}
	}).catch(function(err) {
		ui.addNotification(null, E('p', String(err.message || err)), 'danger');
	});
}

function closestData(el, attr, root) {
	while (el && el !== root) {
		if (el.getAttribute && el.getAttribute(attr))
			return el;
		el = el.parentNode;
	}

	return null;
}

function runLogin() {
	return fs.exec(SCRIPT, [ 'login' ]).then(function(res) {
		var lines = String(res.stdout || '').trim().split('\n').filter(function(l) {
			return l.length > 0;
		});
		var last = lines.length ? lines[lines.length - 1] : (res.stderr || '');

		ui.addNotification(null, E('p', last || _('完成。')),
			res.code == 0 ? 'info' : 'warning');
	}).catch(function(err) {
		ui.addNotification(null, E('p', String(err.message || err)), 'danger');
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callServiceList('drcom'), {}),
			L.resolveDefault(fs.read(STATEFILE), ''),
			L.resolveDefault(fs.exec(SCRIPT, [ 'ua' ]), {})
		]);
	},

	render: function(res) {
		var running = isRunning(res[0]);
		var state = parseState(res[1]);
		var defaultUa = String((res[2] && res[2].stdout) || '').trim() || 'curl/8.x';

		var m, s, o;

		function refreshSession() {
			return fs.exec(SCRIPT, [ 'session' ]).then(function(res) {
				var parts = String((res && res.stdout) || '').trim().split(/\s+/);

				if (parts.length < 3 || !/^[0-9]+$/.test(parts[0])) {
					sessionState.text = '—';
				}
				else {
					sessionState.text = fmtDuration(+parts[0])
						+ ' · ↑' + fmtTraffic(+parts[1])
						+ ' ↓' + fmtTraffic(+parts[2]);
				}

				var el = document.getElementById('drcom-session');
				if (el)
					el.textContent = sessionState.text;
			}).catch(function() {
				sessionState.text = '—';
			});
		}

		function refreshStatus() {
			return Promise.all([
				L.resolveDefault(callServiceList('drcom'), {}),
				L.resolveDefault(fs.read(STATEFILE), '')
			]).then(function(r) {
				var run = isRunning(r[0]);
				var st = parseState(r[1]);

				var badge = document.getElementById('drcom-service-state');
				if (badge) {
					var b = badgeState(run, st);

					badge.className = 'label ' + b.cls;
					badge.textContent = b.text;
				}

				var lastResult = document.getElementById('drcom-last-result');
				if (lastResult)
					lastResult.textContent = formatLast(st);
			});
		}

		function startOrRestart(action) {
			return runInit(action).then(function() {
				return new Promise(function(resolve) {
					window.setTimeout(resolve, 5000);
				});
			}).then(refreshStatus).then(function() {
				var badge = document.getElementById('drcom-service-state');

				if (badge && badge.className.indexOf('success') < 0)
					ui.addNotification(null, E('p',
						_('服务未运行，请到“日志”页查看原因。')), 'warning');
			});
		}

		m = new form.Map('drcom');

		s = m.section(form.TypedSection, 'drcom', _('运行状态'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_service_state', _('服务状态'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() {
			return badgeHtml(running, state);
		};

		o = s.option(form.DummyValue, '_uplink_ip', _('上行 IP'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() {
			return '<span id="drcom-uplink-ip">%s</span>'.format(escapeHtml(ipState.text));
		};

		o = s.option(form.DummyValue, '_session', _('在线时长'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() {
			return '<span id="drcom-session">%s</span>'.format(escapeHtml(sessionState.text));
		};

		o = s.option(form.DummyValue, '_last_result', _('最近结果'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() {
			return '<span id="drcom-last-result">%s</span>'
				.format(escapeHtml(formatLast(state)));
		};

		s = m.section(form.TypedSection, 'drcom', _('服务控制'));
		s.anonymous = true;

		o = s.option(form.DummyValue, '_actions', _('操作'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() {
			return [
				'<button type="button" class="cbi-button cbi-button-action" data-drcom-action="login">%s</button>'
					.format(_('立即登录')),
				'<button type="button" class="cbi-button cbi-button-neutral" data-drcom-action="restart">%s</button>'
					.format(_('重启')),
				'<button type="button" class="cbi-button cbi-button-neutral" data-drcom-action="logout">%s</button>'
					.format(_('退出登录')),
				'<button type="button" class="cbi-button cbi-button-negative" data-drcom-action="stop">%s</button>'
					.format(_('停止'))
			].join(' ');
		};

		s = m.section(form.TypedSection, 'drcom', _('设置'));
		s.anonymous = true;
		s.tab('basic', _('基本'));
		s.tab('portal', _('门户'));
		s.tab('advanced', _('高级'));

		o = s.taboption('basic', form.Flag, 'enabled', _('开机自启'),
			_('勾选后，服务将随系统开机自启。'));
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('basic', form.Value, 'username', _('用户名'),
			_('学号以 T 开头，例如 T202XXXXX。'));
		o.placeholder = 'T202XXXXX';
		o.optional = true;

		o = s.taboption('basic', form.Value, 'password', _('密码'));
		o.password = true;
		o.optional = true;

		o = s.taboption('basic', form.Value, 'operator', _('运营商'),
			_('选择账号对应的宽带运营商。'));
		o.value('unicom', _('中国联通 (unicom)'));
		o.value('cmcc', _('中国移动 (cmcc)'));
		o.value('telecom', _('中国电信 (telecom)'));
		o.placeholder = _('留空（不加 @ 后缀）');
		o.rmempty = true;

		o = s.taboption('basic', form.ListValue, 'device_type', _('设备类型'),
			_('决定账号前缀与 terminal_type，影响校园网后台显示的设备类型。'));
		o.value('pc', _('电脑（,0, + terminal_type=1）'));
		o.value('mobile', _('手机（,1, + terminal_type=2）'));
		o.default = 'pc';
		o.rmempty = false;

		o = s.taboption('portal', form.Value, 'portal_url', _('门户登录地址'));
		o.placeholder = 'http://10.100.100.30:801/eportal/portal/login';
		o.rmempty = true;

		o = s.taboption('portal', form.Value, 'check_url', _('连通性检测地址'),
			_('返回 HTTP 204 即视为外网在线。'));
		o.placeholder = 'http://connect.rom.miui.com/generate_204';
		o.rmempty = true;
		o.onchange = function(ev, section_id, value) {
			scheduleProbe(value);
		};

		o = s.taboption('portal', form.DummyValue, '_check_probe', _('检测结果'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() {
			return '<span id="drcom-probe">%s</span>'.format(escapeHtml(probeState.text));
		};

		o = s.taboption('portal', widgets.DeviceSelect, 'iface', _('上行接口'),
			_('读取 IP 与 MAC 的网卡；只用于本插件的认证流量。'));
		o.noaliases = true;
		o.rmempty = true;
		o.onchange = function() {
			window.setTimeout(refreshRealMac, 500);
		};

		o = s.taboption('portal', form.DummyValue, '_real_mac', _('上行端口 MAC'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() {
			return '<span id="drcom-real-mac">%s</span>'
				.format(escapeHtml(macState.text || _('读取中…')));
		};

		o = s.taboption('portal', form.DummyValue, '_mac_edit', _('修改上行端口 MAC'),
			_('只修改上行端口的 MAC；会写入 /etc/config/network 并重载网络，短暂断网。'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() {
			return ('<input type="text" id="drcom-mac-input" class="cbi-input-text" placeholder="AA:BB:CC:DD:EE:FF" />'
				+ ' <button type="button" class="cbi-button cbi-button-negative" data-drcom-mac="set">%s</button>')
				.format(_('修改'));
		};

		o = s.taboption('advanced', form.Value, 'interval', _('检测间隔'),
			_('两次连通性检测之间的秒数。'));
		o.datatype = 'uinteger';
		o.placeholder = '300';
		o.rmempty = true;

		o = s.taboption('advanced', form.Value, 'retry_interval', _('重试间隔'),
			_('单次登录失败后等待多少秒再重试。'));
		o.datatype = 'uinteger';
		o.placeholder = '15';

		o = s.taboption('advanced', form.Value, 'max_attempts', _('连续失败次数'),
			_('连续失败多少次后进入冷静期。'));
		o.datatype = 'uinteger';
		o.placeholder = '3';

		o = s.taboption('advanced', form.Value, 'cooldown', _('冷静期'),
			_('进入冷静期后多少秒内不再尝试登录。'));
		o.datatype = 'uinteger';
		o.placeholder = '300';
		o.rmempty = true;

		o = s.taboption('advanced', form.Value, 'connect_timeout', _('连接超时'),
			_('请求多少秒无响应视为失败。'));
		o.datatype = 'uinteger';
		o.placeholder = '5';
		o.rmempty = true;

		o = s.taboption('advanced', form.Flag, 'ignore_config_error',
			_('配置错误时继续重试'),
			_('密码、账号等配置错误默认暂停，保存配置后恢复；勾选后忽略，按间隔重试。'));
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('advanced', form.ListValue, 'log_level', _('日志级别'));
		o.value('error', _('错误'));
		o.value('warn', _('警告'));
		o.value('info', _('信息'));
		o.value('debug', _('调试'));
		o.default = 'info';

		o = s.taboption('advanced', form.Value, 'v', _('v 参数'),
			_('门户请求里的 v 参数，默认 7911；固定值不影响登录。'));
		o.datatype = 'uinteger';
		o.placeholder = '7911';
		o.rmempty = true;
		o.depends('v_random', '0');

		o = s.taboption('advanced', form.Flag, 'v_random', _('每次登录随机生成 v'),
			_('勾选后忽略上面填写的值，每次登录发送随机四位数。'));
		o.default = '0';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'user_agent', _('User-Agent'),
			_('留空则使用默认 UA。（HTTP(S) 重写代理插件可能改写该 UA。）'));
		o.placeholder = defaultUa;
		o.rmempty = true;

		o = s.taboption('advanced', form.Flag, 'use_real_mac', _('使用真实 MAC 地址'),
			_('默认发送占位 MAC（全 0）。勾选后发送上行接口的真实 MAC。'));
		o.default = '0';
		o.rmempty = false;

		poll.add(refreshStatus, 5);
		poll.add(refreshUplinkIp, 30);
		poll.add(refreshSession, 30);

		function runSetMac() {
			var input = document.getElementById('drcom-mac-input');
			var mac = input ? String(input.value || '').trim() : '';

			if (!/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(mac)) {
				ui.addNotification(null, E('p',
					_('MAC 格式应为 AA:BB:CC:DD:EE:FF。')), 'warning');
				return;
			}

			ui.showModal(_('修改上行端口 MAC'), [
				E('p', {}, _('将把上行端口的 MAC 改为 %s，写入 /etc/config/network 并重载网络，期间可能短暂断网。')
					.format(mac)),
				E('div', { 'class': 'right' }, [
					E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.hideModal }, _('取消')),
					' ',
					E('button', { 'class': 'cbi-button cbi-button-negative', 'click': function() {
						ui.hideModal();
						applyMac(mac);
					} }, _('继续'))
				])
			]);
		}

		function performLogout() {
			return runInit('stop').then(function() {
				return fs.exec(SCRIPT, [ 'logout' ]);
			}).then(function(res) {
				var out = String((res && res.stdout) || '').trim()
					.split('\n').pop();

				ui.addNotification(null, E('p', {},
					out || _('已发送下线请求，详情见日志页。')), 'info');

				return refreshStatus();
			}).catch(function(err) {
				ui.addNotification(null, E('p', {},
					_('退出失败：%s').format(err)), 'danger');
			});
		}

		function confirmLogout() {
			ui.showModal(_('退出登录'), [
				E('p', {}, _('会先停止服务，再向门户发送下线请求；之后需要手动「启动」才能重新上网。')),
				E('div', { 'class': 'right', 'style': 'margin-top:1rem' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('取消')),
					' ',
					E('button', {
						'class': 'cbi-button cbi-button-negative',
						'click': function() {
							ui.hideModal();
							performLogout();
						}
					}, _('继续'))
				])
			]);
		}

		function confirmDiscover() {
			ui.showModal(_('尝试探测门户'), [
				E('p', {}, _('此操作会先停止服务；若当前在线，会先发送注销请求。随后在门户主机上依次探测 801、80、8080、8081、8000、8090 端口，稍后显示探测结果。')),
				E('div', { 'class': 'right', 'style': 'margin-top:1rem' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('取消')),
					' ',
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'click': function() {
							ui.hideModal();
							runDiscover();
						}
					}, _('继续'))
				])
			]);
		}

		function runDiscover() {
			ui.addNotification(null, E('p', {}, _('正在探测…')), 'info');

			return runInit('stop').then(function() {
				return fs.exec(SCRIPT, [ 'check' ]);
			}).then(function(res) {
				if (res && res.code === 0) {
					return fs.exec(SCRIPT, [ 'logout' ]).then(function() {
						return new Promise(function(resolve) {
							window.setTimeout(resolve, 5000);
						});
					});
				}
			}).then(function() {
				return fs.exec(SCRIPT, [ 'discover' ]);
			}).then(function(res) {
				var lines = String((res && res.stdout) || '')
					.split(/\r?\n/)
					.map(function(s) { return s.trim(); });

				var url = lines.filter(function(l) {
					return /^https?:\/\//.test(l);
				}).pop() || '';

				var host = (lines.filter(function(l) {
					return /^host=/.test(l);
				}).pop() || '').replace(/^host=/, '');

				if (!url) {
					if (host) {
						ui.showModal(_('探测结果'), [
							E('p', {}, _('找到门户主机 %s，但探测的几个端口都没有响应 ePortal。').format(host)),
							E('p', { 'style': 'color:var(--muted-text,#8898aa)' },
								_('可以手动尝试 http://%s:端口/eportal/portal/login；端口不确定时可向网络中心确认或抓包查看。').format(host)),
							E('div', { 'class': 'right', 'style': 'margin-top:1rem' },
								E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('关闭')))
						]);
					}
					else {
						ui.addNotification(null, E('p', {},
							_('未探测到门户（可能已在线，或不是拦截式门户）。')), 'warning');
					}

					return;
				}

				var current = String(uci.get('drcom', 'main', 'portal_url') || '').trim();
				var same = current === url;

				ui.showModal(_('探测结果'), [
					E('p', {}, _('门户登录地址可能是：')),
					E('pre', { 'style': 'user-select:all;white-space:pre-wrap' }, url),
					E('p', { 'style': 'color:var(--muted-text,#8898aa)' }, same
						? _('和当前配置相同。')
						: _('和当前配置不同，可手动填入并保存后尝试登录。')),
					E('div', { 'class': 'right', 'style': 'margin-top:1rem' },
						E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('关闭')))
				]);
			}).catch(function(err) {
				ui.addNotification(null, E('p',
					String(err.message || err)), 'danger');
			});
		}

		function handleAction(ev) {
			var disco = ev.target.closest
				? ev.target.closest('[data-drcom-discover]')
				: null;

			if (disco) {
				ev.preventDefault();
				confirmDiscover();
				return;
			}

			var macBtn = closestData(ev.target, 'data-drcom-mac', ev.currentTarget);

			if (macBtn) {
				ev.preventDefault();
				runSetMac();
				return;
			}

			var el = closestData(ev.target, 'data-drcom-action', ev.currentTarget);

			if (!el)
				return;

			ev.preventDefault();

			var action = el.getAttribute('data-drcom-action');

			if (action === 'login')
				runLogin().then(refreshStatus);
			else if (action === 'stop')
				runInit('stop').then(refreshStatus);
			else if (action === 'logout')
				confirmLogout();
			else
				startOrRestart(action);
		}

		function showAbout() {
			var row = function(label, value) {
				return E('div', { 'style': 'display:flex;gap:.75rem;padding:.15rem 0' }, [
					E('span', { 'style': 'color:var(--muted-text,#8898aa);flex:0 0 4.5rem' }, label),
					E('span', {}, value)
				]);
			};

			ui.showModal(_('关于此插件'), [
				row(_('名称'), 'JXGM DrCOM'),
				row(_('版本'), PKG_VERSION),
				row(_('包名'), 'luci-app-jxgm-drcom'),
				row(_('许可证'), 'Apache License 2.0'),
				row(_('贡献者'), 'wmrasw — ' + _('插件开发、适配等')),
				E('p', { 'style': 'margin:.75rem 0 0;line-height:1.5' },
					_('已在江西工业贸易职业技术学院红谷滩校区于 2026 年 11 月测试可用。')),
				E('p', { 'style': 'margin:.5rem 0 0' },
					E('a', {
						'href': 'https://github.com/wmrasw/JXGMDrcom',
						'target': '_blank',
						'rel': 'noopener'
					}, _('GitHub 仓库'))),
				E('div', { 'class': 'right', 'style': 'margin-top:1rem' },
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('关闭')))
			]);
		}

		function aboutButton() {
			return E('button', {
				'type': 'button',
				'class': 'cbi-button cbi-button-neutral',
				'title': _('关于此插件'),
				'aria-label': _('关于此插件'),
				'style': 'flex:0 0 auto;box-sizing:border-box;'
					+ 'width:2rem;min-width:2rem;max-width:2rem;'
					+ 'height:2rem;min-height:2rem;max-height:2rem;'
					+ 'aspect-ratio:1/1;padding:0;margin-top:.35rem;'
					+ 'border-radius:50%;display:inline-flex;align-items:center;'
					+ 'justify-content:center;overflow:hidden;'
					+ 'font:italic 700 1rem Georgia,serif;line-height:1',
				'click': showAbout
			}, 'i');
		}

		return m.render().then(function(node) {
			node.addEventListener('click', handleAction);

			if (probeState.text === '—') {
				scheduleProbe(uci.get('drcom', 'main', 'check_url'));
			}

			window.setTimeout(refreshRealMac, 300);
			window.setTimeout(refreshUplinkIp, 300);
			window.setTimeout(refreshSession, 500);

			var titleEl = E('h2', {}, _('JXGM DrCOM'));

			// 主题会把与菜单重名的标题加上 vt-repeat 隐藏（压成 1px 高），
			// 这里主动摘掉；若主题之后又加回来，监听 class 再摘一次。
			var stripRepeat = function() {
				if (titleEl.classList.contains('vt-repeat'))
					titleEl.classList.remove('vt-repeat');
			};

			stripRepeat();

			if (window.MutationObserver)
				new MutationObserver(stripRepeat).observe(titleEl,
					{ attributes: true, attributeFilter: [ 'class' ] });

			var info = E('div', { 'style': 'flex:1 1 auto;min-width:0' }, [
				titleEl,
				E('p', {
					'class': 'cbi-map-descr',
					'style': 'color: var(--muted-text, #8898aa)'
				}, _('ePortal is cheap, show me the network.'))
			]);

			// node is not attached to the document yet, so look inside it.
			var portalInput = node.querySelector('input[id$=".portal_url"]')
				|| node.querySelector('input[name$=".portal_url"]');

			if (portalInput && portalInput.parentNode) {
				portalInput.parentNode.appendChild(E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-neutral',
					'data-drcom-discover': '1',
					'style': 'margin-left:.5rem'
				}, _('尝试探测')));
			}

			return E([
				E('div', {
					'style': 'display:flex;align-items:flex-start;gap:.75rem'
				}, [ info, aboutButton() ]),
				node
			]);
		});
	}
});
