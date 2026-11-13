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
'require poll';

var STATEFILE = '/var/run/drcom.state';
var SCRIPT = '/usr/share/drcom/drcom.sh';

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { 'drcom': {} }
});

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

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callServiceList('drcom'), {}),
			L.resolveDefault(fs.read(STATEFILE), '')
		]);
	},

	render: function(res) {
		var running = isRunning(res[0]);
		var state = parseState(res[1]);

		var info = {
			state: running ? _('运行中') : _('已停止'),
			cls: running ? 'success' : 'warning',
			iface: uci.get('drcom', 'main', 'iface') || 'wan',
			ip: '—',
			mac: '—',
			session: '—',
			last: fmtTime(state.last_login),
			result: state.message || '—',
			portal: uci.get('drcom', 'main', 'portal_url') || '—',
			probe: '—'
		};

		function cell(id) {
			return '<span id="%s">%s</span>'.format(id, escapeHtml(info[id.replace('drcom-st-', '')]));
		}

		var m = new form.Map('drcom');

		var s1 = m.section(form.TypedSection, 'drcom', _('运行详情'),
			_('服务状态、在线时长与最近一次认证结果。'));
		s1.anonymous = true;

		var o = s1.option(form.DummyValue, '_state', _('服务状态'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() {
			return '<span id="drcom-st-state" class="label %s">%s</span>'
				.format(info.cls, escapeHtml(info.state));
		};

		o = s1.option(form.DummyValue, '_iface', _('上行接口'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() { return cell('drcom-st-iface'); };

		o = s1.option(form.DummyValue, '_ip', _('上行 IP'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() { return cell('drcom-st-ip'); };

		o = s1.option(form.DummyValue, '_mac', _('上行端口 MAC'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() { return cell('drcom-st-mac'); };

		o = s1.option(form.DummyValue, '_session', _('在线时长'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() { return cell('drcom-st-session'); };

		o = s1.option(form.DummyValue, '_last', _('上次登录'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() { return cell('drcom-st-last'); };

		o = s1.option(form.DummyValue, '_result', _('最近结果'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() { return cell('drcom-st-result'); };

		o = s1.option(form.DummyValue, '_portal', _('门户登录地址'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() { return cell('drcom-st-portal'); };

		o = s1.option(form.DummyValue, '_probe', _('连通性检测'));
		o.rawhtml = true;
		o.optional = true;
		o.cfgvalue = function() { return cell('drcom-st-probe'); };

		var s2 = m.section(form.TypedSection, 'drcom', _('状态页设置'),
			_('这些选项保存在 /etc/config/drcom，保存后立即生效。'));
		s2.anonymous = true;

		o = s2.option(form.Flag, 'status_enabled', _('启用状态信息'),
			_('关闭后，本页不再读取门户状态页，在线时长和流量显示为 —。'));
		o.default = '1';
		o.rmempty = false;
		o.onchange = function() {
			window.setTimeout(refreshAll, 500);
		};

		o = s2.option(form.Value, 'status_url', _('状态地址'),
			_('留空则使用门户主机的 9002 端口。'));
		o.placeholder = 'http://10.100.100.30:9002/';
		o.rmempty = true;

		o = s2.option(form.Value, 'status_interval', _('刷新间隔'),
			_('本页刷新这些信息的秒数。'));
		o.datatype = 'uinteger';
		o.placeholder = '30';
		o.rmempty = true;

		function put(id, text, cls) {
			var el = document.getElementById(id);

			if (!el)
				return;

			el.textContent = text;

			if (cls)
				el.className = 'label ' + cls;
		}

		function refreshAll() {
			var enabled = uci.get('drcom', 'main', 'status_enabled');

			return Promise.all([
				L.resolveDefault(callServiceList('drcom'), {}),
				L.resolveDefault(fs.read(STATEFILE), ''),
				L.resolveDefault(fs.exec(SCRIPT, [ 'ip' ]), ''),
				L.resolveDefault(fs.exec(SCRIPT, [ 'mac' ]), ''),
				(enabled == '0'
					? Promise.resolve('')
					: L.resolveDefault(fs.exec(SCRIPT, [ 'session' ]), '')),
				L.resolveDefault(fs.exec(SCRIPT, [ 'probe', uci.get('drcom', 'main', 'check_url') || 'http://connect.rom.miui.com/generate_204' ]), '')
			]).then(function(r) {
				var run = isRunning(r[0]);
				var st = parseState(r[1]);
				var ip = String((r[2] && r[2].stdout) || '').trim();
				var mac = String((r[3] && r[3].stdout) || '').trim();
				var ses = String((r[4] && r[4].stdout) || '').trim().split(/\s+/);
				var code = String((r[5] && r[5].stdout) || '').trim();

				put('drcom-st-state', run ? _('运行中') : _('已停止'),
					run ? 'success' : 'warning');
				put('drcom-st-ip', ip || '—');
				put('drcom-st-mac', mac || '—');
				put('drcom-st-last', fmtTime(st.last_login));
				put('drcom-st-result', st.message || '—');

				if (ses.length >= 3 && /^[0-9]+$/.test(ses[0]))
					put('drcom-st-session', fmtDuration(+ses[0])
						+ ' · ↑' + fmtTraffic(+ses[1])
						+ ' ↓' + fmtTraffic(+ses[2]));
				else
					put('drcom-st-session', '—');

				put('drcom-st-probe', code == '204' || code == '200'
					? _('可用（HTTP %s）').format(code)
					: _('不可用（%s）').format(code || '000'));
			});
		}

		var interval = +uci.get('drcom', 'main', 'status_interval') || 30;

		poll.add(refreshAll, interval);
		window.setTimeout(refreshAll, 300);

		return m.render();
	}
});
