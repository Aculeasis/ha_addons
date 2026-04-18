'use strict';

// ─── Custom Datetime Picker ───────────────────────────────────────────
// A cross-browser datetime picker that respects 24h/12h settings

class DatetimePicker {
  /**
   * Create a datetime picker instance
   * @param {Object} options - Configuration options
   * @param {HTMLElement} options.container - Container element to render into
   * @param {Date|null} options.value - Initial value
   * @param {Date|null} options.min - Minimum selectable date
   * @param {Date|null} options.max - Maximum selectable date
   * @param {string} options.placeholder - Placeholder text
   * @param {string} options.title - Title/tooltip for the input
   * @param {Function} options.onChange - Callback when value changes
   * @param {boolean} options.use24h - Use 24-hour format
   */
  constructor(options) {
    this.container = options.container;
    this.value = options.value || null;
    this.min = options.min || null;
    this.max = options.max || null;
    this.placeholder = options.placeholder || 'Select date & time';
    this.title = options.title || '';
    this.onChange = options.onChange || (() => {});
    this.use24h = options.use24h !== false; // Default to 24h
    this.isOpen = false;
    this.viewYear = 0;
    this.viewMonth = 0;
    this.selectedDay = null;
    
    this.render();
    this.attachEvents();
  }

  /**
   * Format date for display
   */
  formatDisplay(date) {
    if (!date) return '';
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    
    if (this.use24h) {
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      return `${day}.${month}.${year} ${hours}:${minutes}`;
    } else {
      let hours = date.getHours();
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${day}.${month}.${year} ${hours}:${minutes} ${ampm}`;
    }
  }

  /**
   * Render the picker UI
   */
  render() {
    const displayValue = this.formatDisplay(this.value);
    
    this.container.innerHTML = `
      <div class="dtp-wrapper">
        <button type="button" class="dtp-trigger" title="${this.title}">
          <svg class="dtp-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
            <line x1="3" y1="10" x2="21" y2="10"/>
          </svg>
          <span class="dtp-value ${this.value ? '' : 'dtp-placeholder'}">${displayValue || this.placeholder}</span>
          <svg class="dtp-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <div class="dtp-dropdown hidden">
          <div class="dtp-section dtp-date-section">
            <div class="dtp-header">
              <button type="button" class="dtp-nav dtp-prev-month" title="Previous month">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <span class="dtp-month-year"></span>
              <button type="button" class="dtp-nav dtp-next-month" title="Next month">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </div>
            <div class="dtp-weekdays">
              <span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span>
            </div>
            <div class="dtp-days"></div>
          </div>
          <div class="dtp-section dtp-time-section">
            <div class="dtp-time-header">Time</div>
            <div class="dtp-time-inputs">
              <input type="number" class="dtp-hour" min="0" max="23" placeholder="HH">
              <span class="dtp-time-sep">:</span>
              <input type="number" class="dtp-minute" min="0" max="59" placeholder="MM">
              ${!this.use24h ? `
                <div class="dtp-ampm">
                  <button type="button" class="dtp-ampm-btn" data-ampm="AM">AM</button>
                  <button type="button" class="dtp-ampm-btn" data-ampm="PM">PM</button>
                </div>
              ` : ''}
            </div>
          </div>
          <div class="dtp-actions">
            <button type="button" class="dtp-btn dtp-clear">Clear</button>
            <button type="button" class="dtp-btn dtp-now">Now</button>
            <button type="button" class="dtp-btn dtp-apply">Apply</button>
          </div>
        </div>
      </div>
    `;

    this.trigger = this.container.querySelector('.dtp-trigger');
    this.dropdown = this.container.querySelector('.dtp-dropdown');
    this.daysContainer = this.container.querySelector('.dtp-days');
    this.monthYearDisplay = this.container.querySelector('.dtp-month-year');
    this.hourInput = this.container.querySelector('.dtp-hour');
    this.minuteInput = this.container.querySelector('.dtp-minute');
    this.valueDisplay = this.container.querySelector('.dtp-value');
  }

  /**
   * Attach event listeners
   */
  attachEvents() {
    // Toggle dropdown
    this.trigger.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggle();
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!this.container.contains(e.target)) {
        this.close();
      }
    });

    // Month navigation
    this.container.querySelector('.dtp-prev-month').addEventListener('click', (e) => {
      e.stopPropagation();
      this.viewMonth -= 1;
      if (this.viewMonth < 0) {
        this.viewMonth = 11;
        this.viewYear -= 1;
      }
      this.renderDays();
    });

    this.container.querySelector('.dtp-next-month').addEventListener('click', (e) => {
      e.stopPropagation();
      this.viewMonth += 1;
      if (this.viewMonth > 11) {
        this.viewMonth = 0;
        this.viewYear += 1;
      }
      this.renderDays();
    });

    // Time inputs
    this.hourInput.addEventListener('input', () => this.clampTimeInput('hour'));
    this.minuteInput.addEventListener('input', () => this.clampTimeInput('minute'));

    // AM/PM buttons
    if (!this.use24h) {
      this.container.querySelectorAll('.dtp-ampm-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.container.querySelectorAll('.dtp-ampm-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        });
      });
    }

    // Action buttons
    this.container.querySelector('.dtp-clear').addEventListener('click', (e) => {
      e.stopPropagation();
      this.setValue(null);
      this.close();
    });

    this.container.querySelector('.dtp-now').addEventListener('click', (e) => {
      e.stopPropagation();
      this.setToNow();
    });

    this.container.querySelector('.dtp-apply').addEventListener('click', (e) => {
      e.stopPropagation();
      this.applyAndClose();
    });
  }

  /**
   * Clamp time input values
   */
  clampTimeInput(type) {
    const input = type === 'hour' ? this.hourInput : this.minuteInput;
    const max = type === 'hour' ? (this.use24h ? 23 : 12) : 59;
    const min = type === 'hour' ? (this.use24h ? 0 : 1) : 0;
    
    let value = parseInt(input.value) || 0;
    if (value < min) input.value = String(min).padStart(2, '0');
    if (value > max) input.value = String(max).padStart(2, '0');
  }

  /**
   * Toggle dropdown visibility
   */
  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Open the dropdown
   */
  open() {
    // Initialize view to current value or today
    const baseDate = this.value || new Date();
    this.viewYear = baseDate.getFullYear();
    this.viewMonth = baseDate.getMonth();
    this.selectedDay = this.value ? this.value.getDate() : null;
    
    this.dropdown.classList.remove('hidden');
    this.renderDays();
    this.updateTimeInputs();
    this.isOpen = true;
  }

  /**
   * Close the dropdown
   */
  close() {
    this.dropdown.classList.add('hidden');
    this.isOpen = false;
  }

  /**
   * Render the days grid
   */
  renderDays() {
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
    this.monthYearDisplay.textContent = `${months[this.viewMonth]} ${this.viewYear}`;
    
    const firstDay = new Date(this.viewYear, this.viewMonth, 1);
    const lastDay = new Date(this.viewYear, this.viewMonth + 1, 0);
    const startWeekday = (firstDay.getDay() + 6) % 7; // Monday = 0
    
    let html = '';
    
    // Empty cells before first day
    for (let i = 0; i < startWeekday; i++) {
      html += '<span class="dtp-day dtp-empty"></span>';
    }
    
    // Days of the month
    const today = new Date();
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const date = new Date(this.viewYear, this.viewMonth, day);
      const isDisabled = this.isDateDisabled(date);
      const isToday = this.isSameDay(date, today);
      const isSelected = this.value && this.isSameDay(date, this.value);
      
      let classes = 'dtp-day';
      if (isDisabled) classes += ' disabled';
      if (isToday) classes += ' today';
      if (isSelected) classes += ' selected';
      
      html += `<button type="button" class="${classes}" data-day="${day}" ${isDisabled ? 'disabled' : ''}>${day}</button>`;
    }
    
    this.daysContainer.innerHTML = html;
    
    // Add click handlers for days
    this.daysContainer.querySelectorAll('.dtp-day:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectDay(parseInt(btn.dataset.day));
      });
    });
  }

  /**
   * Check if date is disabled
   */
  isDateDisabled(date) {
    if (this.min && date < this.min && !this.isSameDay(date, this.min)) return true;
    if (this.max && date > this.max && !this.isSameDay(date, this.max)) return true;
    return false;
  }

  /**
   * Check if two dates are the same day
   */
  isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
  }

  /**
   * Select a day
   */
  selectDay(day) {
    this.selectedDay = day;
    // Update visual selection
    this.daysContainer.querySelectorAll('.dtp-day').forEach(btn => {
      btn.classList.remove('selected');
      if (parseInt(btn.dataset.day) === day) {
        btn.classList.add('selected');
      }
    });
  }

  /**
   * Update time inputs from current value
   */
  updateTimeInputs() {
    if (this.value) {
      let hours = this.value.getHours();
      const minutes = this.value.getMinutes();
      
      if (!this.use24h) {
        const ampm = hours >= 12 ? 'PM' : 'AM';
        this.container.querySelectorAll('.dtp-ampm-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.ampm === ampm);
        });
        hours = hours % 12;
        hours = hours ? hours : 12;
      }
      
      this.hourInput.value = String(hours).padStart(2, '0');
      this.minuteInput.value = String(minutes).padStart(2, '0');
    } else {
      this.hourInput.value = '';
      this.minuteInput.value = '';
    }
  }

  /**
   * Set to current time
   */
  setToNow() {
    const now = new Date();
    if (this.min && now < this.min) {
      this.viewYear = this.min.getFullYear();
      this.viewMonth = this.min.getMonth();
      this.selectedDay = this.min.getDate();
    } else if (this.max && now > this.max) {
      this.viewYear = this.max.getFullYear();
      this.viewMonth = this.max.getMonth();
      this.selectedDay = this.max.getDate();
    } else {
      this.viewYear = now.getFullYear();
      this.viewMonth = now.getMonth();
      this.selectedDay = now.getDate();
    }
    this.renderDays();
    this.value = now;
    this.updateTimeInputs();
  }

  /**
   * Apply selection and close
   */
  applyAndClose() {
    // Build date from selections
    let hours = parseInt(this.hourInput.value) || 0;
    const minutes = parseInt(this.minuteInput.value) || 0;
    
    if (!this.use24h) {
      const ampm = this.container.querySelector('.dtp-ampm-btn.active')?.dataset.ampm || 'AM';
      if (ampm === 'PM' && hours !== 12) hours += 12;
      if (ampm === 'AM' && hours === 12) hours = 0;
    }
    
    if (this.selectedDay) {
      this.value = new Date(this.viewYear, this.viewMonth, this.selectedDay, hours, minutes);
    } else if (this.hourInput.value || this.minuteInput.value) {
      // No day selected but time entered - use today
      const today = new Date();
      this.value = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes);
    }
    
    // Update display
    if (this.value) {
      this.valueDisplay.textContent = this.formatDisplay(this.value);
      this.valueDisplay.classList.remove('dtp-placeholder');
    }
    
    this.onChange(this.value);
    this.close();
  }

  /**
   * Set value programmatically
   */
  setValue(date) {
    this.value = date;
    if (this.value) {
      this.viewYear = this.value.getFullYear();
      this.viewMonth = this.value.getMonth();
      this.selectedDay = this.value.getDate();
    }
    
    if (this.value) {
      this.valueDisplay.textContent = this.formatDisplay(this.value);
      this.valueDisplay.classList.remove('dtp-placeholder');
    } else {
      this.valueDisplay.textContent = this.placeholder;
      this.valueDisplay.classList.add('dtp-placeholder');
    }
    
    this.onChange(this.value);
  }

  /**
   * Get timestamp in seconds
   */
  getTimestamp() {
    return this.value ? Math.floor(this.value.getTime() / 1000) : null;
  }
}

// Export for use
window.DatetimePicker = DatetimePicker;