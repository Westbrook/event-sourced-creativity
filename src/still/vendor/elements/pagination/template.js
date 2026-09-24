import { html, nothing } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { repeat } from 'lit/directives/repeat.js';
import { paginationItems, paginationText } from './state.js';
import { iconTemplate } from '../icon/template.js';
export function paginationTemplate(view, change, toggleJump, observeJump, dismissJump, closeJump) {
    const windowPage = view.windowPage ?? view.page;
    const intermediateColumn = (page) => view.pageCount <= 5 ? undefined : page === 1 ? '1' : page === view.pageCount ? '5' : page === windowPage ? '3' : undefined;
    const items = paginationItems(windowPage, view.pageCount);
    const activeGap = windowPage > 2 && windowPage >= view.pageCount - 3 ? 'start' : 'end';
    const intermediateGap = (side) => {
        if (view.pageCount <= 5)
            return nothing;
        const omitted = side === 'start' ? windowPage > 2 : windowPage < view.pageCount - 1;
        const action = omitted && side === activeGap;
        const wideGap = items.some(item => item.kind === 'gap' && item.key === `${side}-gap`);
        return html `<span class="en-pagination__intermediate-gap" part="gap" ?data-wide-gap=${wideGap} data-intermediate-column=${side === 'start' ? '2' : '4'} ?data-gap-action=${action}>
			<span class="en-pagination__gap-decoration" aria-hidden="true">${omitted ? '…' : nothing}</span>
			<button class="en-button en-pagination__gap-trigger" part="control direct-summary" type="button"
				data-variant="secondary" popovertarget="page-jump" aria-haspopup="dialog" aria-label=${view.directLabel}
				?disabled=${view.disabled} @pointerdown=${toggleJump} @click=${toggleJump}><span aria-hidden="true">…</span></button>
		</span>`;
    };
    const status = paginationText(view.pageCount ? view.statusLabel : view.unknownStatusLabel, view.page, view.pageCount);
    const jump = (event) => {
        const container = event.currentTarget.closest('.en-pagination__jump');
        const input = container?.querySelector('input');
        if (input?.reportValidity() && change(input.valueAsNumber, 'page'))
            closeJump();
    };
    return html `
		<nav class="en-pagination" part="base" aria-label=${view.label} tabindex="-1">
			<div class="en-pagination__actions" part="actions">
			<button class="en-button" part="control previous" data-variant="secondary" type="button"
				aria-label=${view.previousLabel} ?disabled=${view.disabled || view.page <= 1} @click=${() => change(view.page - 1, 'previous')}><slot name="previous"><span class="en-pagination__previous-icon" aria-hidden="true">${iconTemplate('chevron-down', '')}</span></slot></button>
			${view.pageCount ? html `<span class="en-pagination__pages" part="pages" ?data-intermediate=${view.pageCount > 5} ?data-omitted=${view.pageCount > 7} style=${styleMap({ '--_en-pagination-digits': `${String(view.pageCount).length}ch` })}>
				${repeat(items, item => item.key, item => item.kind === 'gap'
        ? nothing
        : html `${item.page === view.pageCount ? intermediateGap('end') : nothing}<button class="en-button" part="control page" data-page=${item.page} data-intermediate-column=${intermediateColumn(item.page) ?? nothing} data-variant=${item.page === view.page ? 'primary' : 'ghost'}
						type="button" ?disabled=${view.disabled} aria-current=${item.page === view.page ? 'page' : nothing}
						aria-label=${paginationText(view.pageLabel, item.page, view.pageCount)} @click=${() => change(item.page, 'page')}>${item.page}</button>${item.page === 1 ? intermediateGap('start') : nothing}`)}
			</span>` : nothing}
			<span class="en-pagination__middle" part="middle">
				<span class="en-pagination__status en-pagination__compact-status" part="status compact-status">${status}</span>
				${view.pageCount ? html `<button class="en-button en-pagination__direct-trigger" part="control direct-summary" type="button"
					data-variant="secondary" popovertarget="page-jump" aria-haspopup="dialog" aria-label=${view.directLabel}
					?disabled=${view.disabled} @pointerdown=${toggleJump} @click=${toggleJump}><span aria-hidden="true">…</span></button>` : nothing}
			</span>
			<button class="en-button" part="control next" data-variant="secondary" type="button"
				?disabled=${view.disabled || (view.pageCount ? view.page >= view.pageCount : !view.hasNext) || view.page >= Number.MAX_SAFE_INTEGER}
				aria-label=${view.nextLabel} @click=${() => change(view.page + 1, 'next')}><slot name="next"><span class="en-pagination__next-icon" aria-hidden="true">${iconTemplate('chevron-down', '')}</span></slot></button>
			</div>
			<span class="en-pagination__status en-pagination__wide-status" part="status expanded-status">${status}</span>
			${view.pageCount ? html `
				<div id="page-jump" class="en-pagination__direct" part="direct" popover="auto" role="dialog" aria-label=${view.directLabel} @toggle=${observeJump} @keydown=${dismissJump}>
					<div class="en-pagination__jump" part="jump">
						<label for="page-number">${view.pageNumberLabel}</label>
						<input id="page-number" part="page-input" type="number" inputmode="numeric" min="1" max=${view.pageCount} step="1" required
							.value=${String(view.page)} ?disabled=${view.disabled} @keydown=${(event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            jump(event);
        }
    }}>
						<button class="en-button" part="control cancel" data-variant="ghost" type="button" @click=${closeJump}>${view.cancelLabel}</button>
						<button class="en-button" part="control go" data-variant="secondary" type="button" ?disabled=${view.disabled} @click=${jump}>${view.goLabel}</button>
					</div>
				</div>
			` : nothing}
		</nav>
	`;
}
