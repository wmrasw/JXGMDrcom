/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 wmrasw
 */
'use strict';
'require view';
'require form';
'require fs';
'require rpc';
'require uci';
'require ui';

var STATEFILE = '/var/run/drcom.state';
var SCRIPT = '/usr/share/drcom/drcom.sh';
var timer = null;

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { 'drcom': {} }
});

var CSS = [
	'.drcom-top{margin-bottom:1rem}',
	'.drcom-head{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:.75rem}',
	'.drcom-head h3{margin:0;font-size:1.05rem}',
	'.drcom-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.75rem}',
	'.drcom-card{background:var(--background-color-high,rgba(127,127,127,.08));',
	'border:1px solid rgba(127,127,127,.16);border-radius:.6rem;padding:.8rem 1rem;min-width:0}',
	'.drcom-card .k{font-size:.8rem;color:var(--muted-text,#8898aa)}',
	'.drcom-card .v{font-size:1.45rem;font-weight:600;margin-top:.2rem;word-break:break-all}',
	'.drcom-panel{background:var(--background-color-high,rgba(127,127,127,.08));',
	'border:1px solid rgba(127,127,127,.16);border-radius:.6rem;padding:.9rem 1rem;margin-top:.75rem}',
	'.drcom-panel h4{margin:0 0 .5rem;font-size:.95rem}',
	'.drcom-row{display:flex;gap:.75rem;padding:.2rem 0;font-size:.9rem}',
	'.drcom-row .k{flex:0 0 7rem;color:var(--muted-text,#8898aa)}',
	'.drcom-row .v{min-width:0;word-break:break-all}',
	'.drcom-note{font-size:.8rem;color:var(--muted-text,#8898aa);margin-top:.5rem}'
].join('');

function isRunning(entry) {
	var instances = (entry && entry.instances) || {};

	return Object.keys(instances).some(function(name) {
		var inst = instances[name] || {};

		return inst.running === true ||
			(typeof(inst.pid) == 'number' && inst.pid > 0);
	});
}

function parseState(text) {
	var out = {};

	String(text || '').split('\n').forEach(function(line) {
		var i = line.indexOf('=');

		if (i > 0)
			out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
	});

	return out;
}

function escapeHtml(s) {
	return String(s == null ? '' : s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
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

function fmtTime(ts) {
	if (!ts || ts == '0')
		return _('从未');

	var d = new Date(+ts * 1000);

	return [ d.getFullYear(), pad2(d.getMonth() + 1), pad2(d.getDate()) ].join('/')
		+ ' ' + [ pad2(d.getHours()), pad2(d.getMinutes()), pad2(d.getSeconds()) ].join(':');
}

function card(id, label, value) {
	return E('div', { 'class': 'drcom-card' }, [
		E('div', { 'class': 'k' }, label),
		E('div', { 'class': 'v', 'id': id }, value)
	]);
}

function row(id, label, value) {
	return E('div', { 'class': 'drcom-row' }, [
		E('span', { 'class': 'k' }, label),
		E('span', { 'class': 'v', 'id': id }, value)
	]);
}

return view.extend({
	load: function() {
		return uci.load('drcom').then(function() {
			return Promise.all([
				L.resolveDefault(callServiceList('drcom'), {}),
				L.resolveDefault(fs.read(STATEFILE), '')
			]);
		});
	},

	render: function(res) {
		var running = isRunning(res[0]);
		var state = parseState(res[1]);
		var portal = uci.get('drcom', 'main', 'portal_url') || '';
		var iface = uci.get('drcom', 'main', 'iface') || 'wan';

		var top = E('div', { 'class': 'drcom-top' }, [
			E('div', { 'class': 'drcom-head' }, [
				E('h3', {}, _('运行状态')),
				E('span', {
					'class': 'label ' + (running ? 'success' : 'warning'),
					'id': 'drcom-r-state'
				}, running ? _('运行中') : _('已停止'))
			]),
			E('div', { 'class': 'drcom-cards' }, [
				card('drcom-r-uptime', _('在线时长'), '—'),
				card('drcom-r-ip', _('上行 IP'), '—'),
				card('drcom-r-up', _('上传流量'), '—'),
				card('drcom-r-down', _('下载流量'), '—')
			]),
			E('div', { 'class': 'drcom-note' },
				_('流量由门户按计费周期更新，可能滞后。')),
			E('div', { 'class': 'drcom-panel' }, [
				E('h4', {}, _('最近认证结果')),
				E('div', { 'class': 'v', 'id': 'drcom-r-result' }, state.message || '—'),
				E('div', { 'class': 'drcom-row' }, [
					E('span', { 'class': 'k' }, _('上次登录')),
					E('span', { 'class': 'v', 'id': 'drcom-r-last' }, fmtTime(state.last_login))
				])
			]),
			E('div', { 'class': 'drcom-panel' }, [
				E('h4', {}, _('详细信息')),
				row('drcom-r-iface', _('上行接口'), iface),
				row('drcom-r-mac', _('上行端口 MAC'), '—'),
				E('div', { 'class': 'drcom-row' }, [
					E('span', { 'class': 'k' }, _('门户登录地址')),
					E('span', { 'class': 'v', 'id': 'drcom-r-portal' },
						portal || '—')
				]),
				row('drcom-r-probe', _('连通性检测'), '—')
			])
		]);

		var m = new form.Map('drcom');

		var s = m.section(form.TypedSection, 'drcom', _('状态页设置'),
			_('这些选项保存在 /etc/config/drcom，保存后立即生效。'));
		s.anonymous = true;

		var o = s.option(form.Flag, 'status_enabled', _('启用状态信息'),
			_('关闭后，本页不再读取门户状态页，时长和流量显示为 —。'));
		o.default = '1';
		o.rmempty = false;
		o.onchange = function() {
			window.setTimeout(refreshAll, 500);
		};

		o = s.option(form.Value, 'status_url', _('状态地址'),
			_('留空则使用门户主机的 9002 端口。'));
		o.placeholder = 'http://10.100.100.30:9002/';
		o.rmempty = true;

		o = s.option(form.Value, 'status_interval', _('刷新间隔'),
			_('本页刷新这些信息的秒数。'));
		o.datatype = 'uinteger';
		o.placeholder = '30';
		o.rmempty = true;

		function put(id, text) {
			var el = document.getElementById(id);

			if (el)
				el.textContent = text;
		}

		function refreshAll() {
			var enabled = uci.get('drcom', 'main', 'status_enabled');
			var checkUrl = uci.get('drcom', 'main', 'check_url')
				|| 'http://connect.rom.miui.com/generate_204';

			return Promise.all([
				L.resolveDefault(callServiceList('drcom'), {}),
				L.resolveDefault(fs.read(STATEFILE), ''),
				L.resolveDefault(fs.exec(SCRIPT, [ 'ip' ]), ''),
				L.resolveDefault(fs.exec(SCRIPT, [ 'mac' ]), ''),
				(enabled == '0'
					? Promise.resolve('')
					: L.resolveDefault(fs.exec(SCRIPT, [ 'session' ]), '')),
				L.resolveDefault(fs.exec(SCRIPT, [ 'probe', checkUrl ]), '')
			]).then(function(r) {
				var run = isRunning(r[0]);
				var st = parseState(r[1]);
				var ip = String((r[2] && r[2].stdout) || '').trim();
				var mac = String((r[3] && r[3].stdout) || '').trim();
				var ses = String((r[4] && r[4].stdout) || '').trim().split(/\s+/);
				var code = String((r[5] && r[5].stdout) || '').trim();

				var badge = document.getElementById('drcom-r-state');
				if (badge) {
					badge.className = 'label ' + (run ? 'success' : 'warning');
					badge.textContent = run ? _('运行中') : _('已停止');
				}

				put('drcom-r-ip', ip || '—');
				put('drcom-r-mac', mac || '—');
				put('drcom-r-last', fmtTime(st.last_login));
				put('drcom-r-result', st.message || '—');
				put('drcom-r-probe', code == '204' || code == '200'
					? _('可用（HTTP %s）').format(code)
					: _('不可用（%s）').format(code || '000'));

				if (ses.length >= 3 && /^[0-9]+$/.test(ses[0])) {
					put('drcom-r-uptime', fmtDuration(+ses[0]));
					put('drcom-r-up', fmtTraffic(+ses[1]));
					put('drcom-r-down', fmtTraffic(+ses[2]));
				}
				else {
					put('drcom-r-uptime', '—');
					put('drcom-r-up', '—');
					put('drcom-r-down', '—');
				}
			});
		}

		function nextDelay() {
			var v = +uci.get('drcom', 'main', 'status_interval');

			return (v > 0 ? v : 30) * 1000;
		}

		function loop() {
			Promise.resolve(refreshAll()).catch(function() {}).then(function() {
				timer = window.setTimeout(loop, nextDelay());
			});
		}

		if (timer) {
			window.clearTimeout(timer);
			timer = null;
		}

		window.setTimeout(loop, 300);

		return m.render().then(function(node) {
			return E([
				E('style', {}, CSS),
				top,
				node
			]);
		});
	}
});
