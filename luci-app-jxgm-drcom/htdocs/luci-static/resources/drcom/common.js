/* SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 wmrasw
 */
'use strict';
'require baseclass';
'require ui';

// Keep in sync with PKG_VERSION in the Makefile; the CI build fails if they
// disagree, because the about dialog reads this constant.
var PKG_VERSION = '1.1.0';

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

// Some themes hide a heading that duplicates the menu title by adding
// vt-repeat (collapsing it to 1px); drop the class, and keep dropping it.
function title(text) {
	var el = E('h2', {}, text);

	var stripRepeat = function() {
		if (el.classList.contains('vt-repeat'))
			el.classList.remove('vt-repeat');
	};

	stripRepeat();

	if (window.MutationObserver)
		new MutationObserver(stripRepeat).observe(el,
			{ attributes: true, attributeFilter: [ 'class' ] });

	return el;
}

function header() {
	var titleEl = title(_('JXGM DrCOM'));

	return E('div', {
		'style': 'display:flex;align-items:flex-start;gap:.75rem'
	}, [
		E('div', { 'style': 'flex:1 1 auto;min-width:0' }, [
			titleEl,
			E('p', {
				'class': 'cbi-map-descr',
				'style': 'color: var(--muted-text, #8898aa)'
			}, _('ePortal is cheap, show me the network.'))
		]),
		aboutButton()
	]);
}

return baseclass.extend({
	__name__: 'drcom.common',
	PKG_VERSION: PKG_VERSION,
	header: header,
	title: title
});
