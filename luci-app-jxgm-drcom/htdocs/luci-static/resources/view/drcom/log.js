/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 wmrasw
 */
'use strict';
'require view';
'require fs';
'require poll';
'require ui';
'require drcom/common as common';

var LOGFILE = '/var/log/drcom.log';
var MAXLINES = 200;
var INTERVAL = 5;

var activeRefresh = null;
var visibilityHook = null;

// 模块只加载一次，所以监听器也只注册一次；visibilityHook 指向当前页面的控制器。
document.addEventListener('visibilitychange', function() {
	if (visibilityHook)
		visibilityHook();
});

function tail() {
	return fs.lines(LOGFILE).then(function(lines) {
		return lines.slice(-MAXLINES).join('\n') || _('暂无日志。');
	});
}

return view.extend({
	render: function() {
		var output = E('pre', {}, _('加载中…'));
		var userPaused = false;
		var hiddenPaused = false;

		// 上一次渲染遗留的轮询先摘掉，避免切页面后重复刷新。
		if (activeRefresh) {
			poll.remove(activeRefresh);
			activeRefresh = null;
		}

		function refresh() {
			return tail().then(function(text) {
				output.textContent = text;
			});
		}

		function syncPoll() {
			var active = !userPaused && !hiddenPaused;

			if (active) {
				poll.add(refresh, INTERVAL);
				activeRefresh = refresh;
			}
			else {
				poll.remove(refresh);
				if (activeRefresh === refresh)
					activeRefresh = null;
			}

			toggleBtn.textContent = active ? _('停止刷新') : _('继续刷新');
		}

		var toggleBtn = E('button', {
			'class': 'cbi-button cbi-button-neutral',
			'click': function() {
				userPaused = !userPaused;
				syncPoll();

				if (!userPaused)
					refresh();
			}
		}, _('停止刷新'));

		var clearBtn = E('button', {
			'class': 'cbi-button cbi-button-negative',
			'click': function() {
				return fs.write(LOGFILE, '').then(function() {
					ui.addNotification(null, E('p', _('日志已清空。')), 'info');
					return refresh();
				}).catch(function(err) {
					ui.addNotification(null, E('p',
						String(err.message || err)), 'danger');
				});
			}
		}, _('清除日志'));

		// 页面切到后台自动停刷新，切回来自动恢复（用户手动暂停时保持暂停）。
		visibilityHook = function() {
			hiddenPaused = !!document.hidden;
			syncPoll();

			if (!hiddenPaused && !userPaused)
				refresh();
		};

		syncPoll();
		refresh();

		return E([
			common.title(_('DrCOM 日志')),
			E('div', { 'class': 'cbi-section' }, [
				E('div', { 'class': 'cbi-section-descr' },
					_('最近 %d 行日志（%s），每 %d 秒刷新。')
						.format(MAXLINES, LOGFILE, INTERVAL)),
				output
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				toggleBtn,
				' ',
				clearBtn
			])
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
