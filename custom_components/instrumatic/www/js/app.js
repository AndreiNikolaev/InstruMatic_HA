import { Api } from './api.js';

const { createApp, ref, computed, onMounted, watch, nextTick } = Vue;

/**
 * MaintenanceCalculator: Identical logic to Android's DateUtils/MaintenanceLogic
 */
const MaintenanceCalculator = {
    FAR_FUTURE: '2099-12-31',

    calculateNextDate(task, installationDate) {
        // If we have a manually set date, honor it.
        if (task.manualNextDate) return task.manualNextDate;

        // One-time tasks that are completed go to the far future
        if (task.isOneTime && task.lastCompletedDate) return this.FAR_FUTURE;

        let baseDate = dayjs();
        if (task.lastCompletedDate) {
            baseDate = dayjs(task.lastCompletedDate, ['YYYY-MM-DD', 'DD.MM.YYYY']);
        } else if (installationDate) {
            baseDate = dayjs(installationDate);
        }

        return this.addPeriod(baseDate, task.periodicity).format('YYYY-MM-DD');
    },

    addPeriod(base, periodicity) {
        if (!periodicity) return base.add(1, 'year');
        const clean = periodicity.toLowerCase().trim();
        
        // Handle compound periodicities like "1 месяц или 300 часов"
        // Priority: year > month > week > day > hour
        // Split by "или" or "or" to get alternatives
        const alternatives = clean.split(/\s*(?:или|or)\s*/);
        
        // Try to find the best alternative (prefer days/months/years over hours)
        let bestAlternative = alternatives[0]; // Default to first
        
        // Look for alternatives with larger time units (not hours)
        for (const alt of alternatives) {
            const hasHours = alt.includes('час') || alt.includes('hour');
            const hasLargerUnit = alt.includes('год') || alt.includes('лет') || alt.includes('year') ||
                                  alt.includes('мес') || alt.includes('month') ||
                                  alt.includes('нед') || alt.includes('week') ||
                                  alt.includes('день') || alt.includes('дн') || alt.includes('day');
            
            // Prefer larger units over hours
            if (hasLargerUnit && !hasHours) {
                bestAlternative = alt;
                break;
            }
        }
        
        // If all alternatives have hours, use the first one
        const numberMatch = bestAlternative.match(/\d+/);
        const number = numberMatch ? parseInt(numberMatch[0]) : 1;

        if (bestAlternative.includes('час') || bestAlternative.includes('hour')) return base.add(number, 'hour');
        if (bestAlternative.includes('нед') || bestAlternative.includes('week')) return base.add(number, 'week');
        if (bestAlternative.includes('день') || bestAlternative.includes('дн') || bestAlternative.includes('day')) return base.add(number, 'day');
        if (bestAlternative.includes('мес') || bestAlternative.includes('month')) return base.add(number, 'month');
        if (bestAlternative.includes('год') || bestAlternative.includes('лет') || bestAlternative.includes('year')) return base.add(number, 'year');
        if (bestAlternative.includes('квартал') || bestAlternative.includes('quarter')) return base.add(number * 3, 'month');

        return base.add(1, 'year');
    }
};

const app = createApp({
    setup() {
        const lang = ref('en');
        const translations = ref({});
        const isLoaded = ref(false);
        const data = ref({
            locations: [],
            equipment: [],
            tasks: [],
            components: [],
            history: [],
            ha_devices: [],
            settings: {},
            remaining_attempts: null,
            expiry_date: null
        });

        // Confirm Dialog State
        const confirmDialog = ref({
            show: false,
            title: '',
            message: '',
            confirmText: '',
            isDanger: false,
            onConfirm: () => {},
            onCancel: () => { confirmDialog.value.show = false; }
        });

        const showConfirm = (options) => {
            return new Promise((resolve) => {
                confirmDialog.value = {
                    show: true,
                    title: options.title || '',
                    message: options.message || '',
                    confirmText: options.confirmText || '',
                    isDanger: !!options.isDanger,
                    onConfirm: () => {
                        confirmDialog.value.show = false;
                        resolve(true);
                    },
                    onCancel: () => {
                        confirmDialog.value.show = false;
                        resolve(false);
                    }
                };
            });
        };

        const currentEquipmentId = ref(null);
        const selectedLocation = ref('');
        const detailTab = ref('tasks');
        const showUpcomingTasks = ref(false);
        const showAppInfo = ref(false);

        // App Info related refs
        const userKey = ref('');
        const transferCode = ref('');
        const enterCodeInput = ref('');
        const isGeneratingCode = ref(false);
        const isApplyingCode = ref(false);
        const showEnterCodeModal = ref(false);

        // Purchase related refs
        const showPurchaseModal = ref(false);
        const packages = ref([]);
        const purchaseLoading = ref(false);
        const purchaseProcessing = ref(false);
        const purchaseMessage = ref('');
        const purchaseSuccess = ref(false);
        const pendingPaymentId = ref(null);
        const isPaymentsEnabled = ref(true);

        // Flag to prevent auto-calculation while initializing the form
        const isFormLoading = ref(false);

        const headerTitle = computed(() => {
            if (showAppInfo.value) return t('frontend.app_info_title');
            if (showUpcomingTasks.value) return t('frontend.upcoming_maintenance_title');
            if (currentEquipmentId.value) return currentItem.value.name || '';
            return t('frontend.equipment');
        });

        const goBack = () => {
            if (showAppInfo.value) {
                showAppInfo.value = false;
            } else if (showUpcomingTasks.value) {
                showUpcomingTasks.value = false;
            } else {
                currentEquipmentId.value = null;
            }
        };

        const expandedTasks = ref(new Set());
        const showRules = ref(false);

        const thresholds = computed(() => ({
            red: data.value.settings?.redThreshold || 5,
            yellow: data.value.settings?.yellowThreshold || 20,
            green: data.value.settings?.greenThreshold || 30
        }));

        const toggleTask = (taskId) => {
            if (expandedTasks.value.has(taskId)) {
                expandedTasks.value.delete(taskId);
            } else {
                expandedTasks.value.add(taskId);
            }
        };

        const ensureArray = (val) => {
            if (!val) return [];
            if (Array.isArray(val)) return val;
            if (typeof val === 'string') {
                const trimmed = val.trim();
                if (!trimmed) return [];
                if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        if (Array.isArray(parsed)) return parsed;
                    } catch (e) {}
                }
                return trimmed.split('\n').map(s => s.trim()).filter(s => s);
            }
            return [];
        };

        const fetchData = async () => {
            try {
                const json = await Api.getData();
                data.value = { ...data.value, ...json };
                lang.value = (json.language || 'en').split('-')[0];
                userKey.value = json.user_key || '';

                const loadTrans = async (l) => {
                    const trans = await Api.loadTranslations(l);
                    if (trans) translations.value[l] = trans;
                };
                await loadTrans('en');
                if(lang.value !== 'en') await loadTrans(lang.value);

                dayjs.locale(lang.value);
                selectedLocation.value = t('frontend.all_locations');
                isLoaded.value = true;

                await refreshAiStatus();

                const savedJobId = localStorage.getItem('instrumatic_active_job_id');
                if (savedJobId) {
                    wizardState.value = 'processing';
                    processingMessage.value = t('frontend.ai_studying_msg');
                    pollJob(savedJobId);
                }
                
                // Periodically check for language changes (every 10 seconds)
                setInterval(async () => {
                    try {
                        const json = await Api.getData();
                        const newLang = (json.language || 'en').split('-')[0];
                        if (newLang !== lang.value) {
                            console.log('[Language] Changed from', lang.value, 'to', newLang);
                            
                            // Load new language translations if needed
                            if (!translations.value[newLang]) {
                                const trans = await Api.loadTranslations(newLang);
                                if (trans) translations.value[newLang] = trans;
                            }
                            
                            lang.value = newLang;
                            dayjs.locale(lang.value);
                        }
                    } catch (e) {
                        console.warn('[Language] Failed to check:', e);
                    }
                }, 10000); // Check every 10 seconds
            } catch (e) {
                console.error("Failed to fetch data", e);
            }
        };

        const refreshAiStatus = async () => {
            try {
                const status = await Api.proxyRequest('GET', 'status');
                if (status) {
                    data.value.remaining_attempts = status.remaining;
                    data.value.expiry_date = status.expires_at;
                }
            } catch (e) {
                console.warn("AI Status check failed:", e);
            }
        };

        onMounted(fetchData);

        const t = (path) => {
            const keys = path.split('.');
            let res = translations.value[lang.value] || translations.value['en'] || {};
            for (const key of keys) { res = res[key] || null; if(!res) break; }
            return res || path;
        };

        // Convert date to YYYY-MM-DD format for input type="date"
        const toDateInput = (dateStr) => {
            if (!dateStr) return '';
            // Try to parse DD.MM.YYYY or YYYY-MM-DD
            const d = dayjs(dateStr, ['DD.MM.YYYY', 'YYYY-MM-DD', 'D MMMM YYYY']);
            const result = d.isValid() ? d.format('YYYY-MM-DD') : '';
            console.log('[toDateInput]', dateStr, '->', result);
            return result;
        };

        // Format date according to HA user settings
        const formatDate = (date, formatType = 'date') => {
            if (!date) return '';
            
            const d = dayjs(date, ['YYYY-MM-DD', 'DD.MM.YYYY']);
            if (!d.isValid()) return date;
            
            // Use localized formats based on language
            if (lang.value === 'ru') {
                if (formatType === 'date') return d.format('DD.MM.YYYY');
                if (formatType === 'date_long') return d.format('D MMMM YYYY');
                if (formatType === 'time') return d.format('HH:mm');
                if (formatType === 'datetime') return d.format('DD.MM.YYYY HH:mm');
            } else {
                // English format
                if (formatType === 'date') return d.format('MM/DD/YYYY');
                if (formatType === 'date_long') return d.format('MMMM D, YYYY');
                if (formatType === 'time') return d.format('h:mm A');
                if (formatType === 'datetime') return d.format('MM/DD/YYYY h:mm A');
            }
            
            return d.format('YYYY-MM-DD');
        };

        const filteredEquipment = computed(() => {
            const allLoc = t('frontend.all_locations');
            return (data.value.equipment || []).filter(e => !selectedLocation.value || selectedLocation.value === allLoc || e.location === selectedLocation.value);
        });

        const getNextMaintenanceInfo = (eq) => {
            const tasks = (data.value.tasks || []).filter(t => t.equipmentId === eq.id);
            if (!tasks.length) return null;

            let earliest = null;
            let taskName = '';
            tasks.forEach(task => {
                const next = MaintenanceCalculator.calculateNextDate(task, eq.installationDate);
                if (next === MaintenanceCalculator.FAR_FUTURE) return;
                if (!earliest || dayjs(next).isBefore(dayjs(earliest))) {
                    earliest = next;
                    taskName = task.taskName;
                }
            });
            return earliest ? { date: earliest, task: taskName } : null;
        };

        const equipmentWithDates = computed(() => {
            return filteredEquipment.value.map(item => {
                const info = getNextMaintenanceInfo(item);
                return {
                    ...item,
                    nextServiceDate: info ? info.date : null,
                    nextServiceTask: info ? info.task : null
                };
            });
        });

        const upcomingTasks = computed(() => {
            const allTasks = data.value.tasks || [];
            const equipmentList = data.value.equipment || [];
            const now = dayjs();
            const greenThreshold = thresholds.value.green;

            return allTasks.mapNotNull(task => {
                const eq = equipmentList.find(e => e.id === task.equipmentId);
                if (!eq) return null;

                const nextDateStr = MaintenanceCalculator.calculateNextDate(task, eq.installationDate);
                if (nextDateStr === MaintenanceCalculator.FAR_FUTURE) return null;

                const nextDate = dayjs(nextDateStr);
                const daysUntil = nextDate.diff(now, 'day');
                const isZeroPeriod = (task.periodicity || '').startsWith('0');

                if (!isZeroPeriod && daysUntil <= greenThreshold) {
                    const isOverdue = nextDate.isBefore(now, 'day');
                    let statusColor = 'var(--ha-success-color)';
                    if (isOverdue || daysUntil < thresholds.value.red) statusColor = 'var(--ha-error-color)';
                    else if (daysUntil <= thresholds.value.yellow) statusColor = 'var(--ha-warning-color)';

                    // Format remaining time similar to Android
                    let timeText = '';
                    const absDays = Math.abs(daysUntil);
                    if (absDays === 0) {
                        timeText = dayjs().to(nextDate);
                    } else if (absDays === 1) {
                        timeText = '1 ' + t('frontend.unit_day_short');
                    } else {
                        timeText = absDays + ' ' + t('frontend.unit_day_short');
                    }

                    return {
                        id: task.id,
                        taskName: task.taskName,
                        equipmentId: task.equipmentId,
                        equipmentName: eq.name,
                        nextDate: nextDateStr,
                        daysUntil,
                        isOverdue,
                        statusColor,
                        timeText,
                        lastDate: task.lastCompletedDate,
                        task: task
                    };
                }
                return null;
            }).filter(t => t !== null).sort((a, b) => a.daysUntil - b.daysUntil);
        });

        // Helper to mimic Kotlin's mapNotNull
        if (!Array.prototype.mapNotNull) {
            Array.prototype.mapNotNull = function(callback) {
                return this.reduce((acc, x, i) => {
                    const res = callback(x, i, this);
                    if (res !== null && res !== undefined) acc.push(res);
                    return acc;
                }, []);
            };
        }

        const currentItem = computed(() => {
            const item = (data.value.equipment || []).find(e => e.id === currentEquipmentId.value);
            if (!item) return {};
            return {
                ...item,
                importantRules: ensureArray(item.importantRules)
            };
        });

        const currentTasks = computed(() => {
            const tasks = (data.value.tasks || []).filter(t => t.equipmentId === currentEquipmentId.value);
            return tasks.map(task => {
                const nextDate = MaintenanceCalculator.calculateNextDate(task, currentItem.value.installationDate);
                const daysRemaining = nextDate === MaintenanceCalculator.FAR_FUTURE ? 9999 : dayjs(nextDate).diff(dayjs(), 'days');

                let status = 'green';
                if (daysRemaining < 0 || daysRemaining < thresholds.value.red) status = 'red';
                else if (daysRemaining <= thresholds.value.yellow) status = 'amber';

                // Format periodicity with proper pluralization
                const formattedPeriodicity = formatPeriodicity(task.periodicity);

                return {
                    ...task,
                    instructions: ensureArray(task.instructions),
                    requiredComponents: ensureArray(task.requiredComponents),
                    nextDate,
                    daysRemaining,
                    status,
                    periodicity: formattedPeriodicity
                };
            }).sort((a, b) => dayjs(a.nextDate).diff(dayjs(b.nextDate)));
        });

        const currentComponents = computed(() => (data.value.components || []).filter(c => c.equipmentId === currentEquipmentId.value));
        const currentHistory = computed(() => (data.value.history || []).filter(h => h.equipmentId === currentEquipmentId.value).sort((a,b) => b.timestamp - a.timestamp));

        const getStatusClass = (item) => {
            const nextDate = item.nextServiceDate;
            if (!nextDate) return 'status-green';
            const diff = dayjs(nextDate).diff(dayjs(), 'days');
            if (diff < 0 || diff < thresholds.red) return 'status-red';
            if (diff <= thresholds.yellow) return 'status-amber';
            return 'status-green';
        };

        const getStatusColor = (item) => {
            const nextDate = item.nextServiceDate;
            if (!nextDate) return 'var(--ha-success-color)';
            const diff = dayjs(nextDate).diff(dayjs(), 'days');
            if (diff < 0 || diff < thresholds.value.red) return 'var(--ha-error-color)';
            if (diff <= thresholds.value.yellow) return 'var(--ha-warning-color)';
            return 'var(--ha-success-color)';
        };

        const openDetails = (id) => {
            currentEquipmentId.value = id;
            detailTab.value = 'tasks';
            expandedTasks.value.clear();
            showRules.value = false;
        };

        const showEditModal = ref(false);
        const editForm = ref({ id: null, name: '', brand: '', model: '', type: '', location: '', installationDate: '', documentationUrl: '', importantRulesText: '', nextServiceDate: '', nextServiceTask: '' });

        const editEquipment = (item) => {
            const rules = ensureArray(item.importantRules);
            const info = getNextMaintenanceInfo(item);
            editForm.value = {
                ...item,
                importantRulesText: rules.join('\n'),
                nextServiceDate: info ? info.date : null,
                nextServiceTask: info ? info.task : null
            };
            showEditModal.value = true;
        };

        const copyEquipment = (item) => {
            const newItem = JSON.parse(JSON.stringify(item));
            delete newItem.id;
            newItem.name = `${newItem.name} (Copy)`;
            const rules = ensureArray(newItem.importantRules);
            editForm.value = { ...newItem, importantRulesText: rules.join('\n'), nextServiceDate: null, nextServiceTask: null };
            showEditModal.value = true;
        };

        const saveEquipment = async () => {
            const payload = { ...editForm.value, importantRules: editForm.value.importantRulesText.split('\n').filter(r => r.trim()) };
            delete payload.importantRulesText;
            delete payload.nextServiceDate;
            delete payload.nextServiceTask;
            const resData = await Api.saveEquipment('save', 'equipment', payload);
            if(resData.success) { data.value = resData.data; showEditModal.value = false; }
        };

        const deleteEquipment = async () => {
            if (!(await showConfirm({ message: t('frontend.delete_confirm'), isDanger: true }))) return;
            const resData = await Api.saveEquipment('delete', 'equipment', { id: editForm.value.id });
            if(resData.success) { data.value = resData.data; showEditModal.value = false; currentEquipmentId.value = null; }
        };

        const deleteEquipmentDirect = async (item) => {
            if (!(await showConfirm({ message: t('frontend.delete_confirm'), isDanger: true }))) return;
            const resData = await Api.saveEquipment('delete', 'equipment', { id: item.id });
            if(resData.success) { data.value = resData.data; }
        };

        const showTaskModal = ref(false);
        const taskForm = ref({
            id: null,
            equipmentId: null,
            taskName: '',
            periodicity: '',
            periodValue: '1',
            periodUnit: 'year',
            instructionsText: '',
            isOneTime: false,
            estimatedCost: 0,
            manualNextDate: null,
            lastCompletedDate: '',
            requiredComponents: []
        });

        /**
         * Calculates date automatically but MUST honor manualNextDate if it exists
         * unless the user explicitly changed periodicity parameters.
         */
        const calculateAutoDate = () => {
            const taskObj = {
                periodicity: `${taskForm.value.periodValue} ${taskForm.value.periodUnit}`,
                isOneTime: taskForm.value.isOneTime,
                lastCompletedDate: taskForm.value.lastCompletedDate,
                manualNextDate: null // We want the calculated version here
            };
            return MaintenanceCalculator.calculateNextDate(taskObj, currentItem.value.installationDate);
        };

        watch([
            () => taskForm.value.periodValue,
            () => taskForm.value.periodUnit,
            () => taskForm.value.lastCompletedDate,
            () => taskForm.value.isOneTime
        ], () => {
            // ONLY auto-calculate if form is not loading data from an existing task
            if (showTaskModal.value && !isFormLoading.value) {
                taskForm.value.manualNextDate = calculateAutoDate();
            }
        });

        const addTaskMaterial = (name) => {
            if (name && !taskForm.value.requiredComponents.includes(name)) {
                taskForm.value.requiredComponents.push(name);
            }
        };
        const removeTaskMaterial = (name) => {
            taskForm.value.requiredComponents = taskForm.value.requiredComponents.filter(c => c !== name);
        };

        const openTaskEdit = (task) => {
            isFormLoading.value = true;
            if (task) {
                const inst = ensureArray(task.instructions);
                const comps = ensureArray(task.requiredComponents);
                const pv = (task.periodicity || '').match(/\d+/)?.[0] || '1';
                let pu = 'year';
                const pLower = (task.periodicity || '').toLowerCase();
                // Support both Russian and English unit names for backwards compatibility
                if (pLower.includes('дн') || pLower.includes('day')) pu = 'day';
                else if (pLower.includes('нед') || pLower.includes('week')) pu = 'week';
                else if (pLower.includes('мес') || pLower.includes('month')) pu = 'month';
                else if (pLower.includes('год') || pLower.includes('лет') || pLower.includes('year')) pu = 'year';

                taskForm.value = {
                    ...task,
                    instructionsText: inst.join('\n'),
                    periodValue: pv,
                    periodUnit: pu,
                    lastCompletedDate: toDateInput(task.lastCompletedDate),
                    requiredComponents: comps,
                    // Populate field with calculated date if manualNextDate is missing,
                    // so the user always sees the actual next date.
                    manualNextDate: toDateInput(task.manualNextDate) || (task.nextDate && task.nextDate !== MaintenanceCalculator.FAR_FUTURE ? toDateInput(task.nextDate) : null)
                };
            } else {
                taskForm.value = {
                    id: null,
                    equipmentId: currentEquipmentId.value,
                    taskName: '',
                    periodicity: '1 year',
                    periodValue: '1',
                    periodUnit: 'year',
                    instructionsText: '',
                    isOneTime: false,
                    estimatedCost: 0,
                    manualNextDate: null,
                    lastCompletedDate: '',
                    requiredComponents: []
                };
                taskForm.value.manualNextDate = calculateAutoDate();
            }
            showTaskModal.value = true;

            // Allow Vue to process watchers before turning off the loading flag
            setTimeout(() => {
                isFormLoading.value = false;
            }, 100);
        };

        const saveTask = async () => {
            const payload = {
                ...taskForm.value,
                periodicity: `${taskForm.value.periodValue} ${taskForm.value.periodUnit}`,
                instructions: taskForm.value.instructionsText.split('\n').filter(i => i.trim())
            };
            delete payload.instructionsText;
            delete payload.periodValue;
            delete payload.periodUnit;
            // nextDate is a computed helper in currentTasks, don't send to backend
            delete payload.nextDate;
            delete payload.daysRemaining;
            delete payload.status;

            const resData = await Api.saveEquipment('save', 'tasks', payload);
            if(resData.success) { data.value = resData.data; showTaskModal.value = false; }
        };

        const deleteTask = async () => {
            if (!(await showConfirm({ message: t('frontend.delete_confirm'), isDanger: true }))) return;
            const resData = await Api.saveEquipment('delete', 'tasks', { id: taskForm.value.id });
            if(resData.success) { data.value = resData.data; showTaskModal.value = false; }
        };

        const deleteTaskDirect = async (task) => {
            if (!(await showConfirm({ message: t('frontend.delete_confirm'), isDanger: true }))) return;
            const resData = await Api.saveEquipment('delete', 'tasks', { id: task.id });
            if(resData.success) { data.value = resData.data; }
        };

        const showMaterialModal = ref(false);
        const materialForm = ref({ id: null, equipmentId: null, name: '', partNumber: '', description: '', quantity: '', cost: 0 });
        const openMaterialEdit = (comp) => { if (comp) { materialForm.value = { ...comp }; } else { materialForm.value = { id: null, equipmentId: currentEquipmentId.value, name: '', partNumber: '', description: '', quantity: '', cost: 0 }; } showMaterialModal.value = true; };
        const saveMaterial = async () => { const resData = await Api.saveEquipment('save', 'components', materialForm.value); if(resData.success) { data.value = resData.data; showMaterialModal.value = false; } };
        const deleteMaterial = async () => {
            if (!(await showConfirm({ message: t('frontend.delete_confirm'), isDanger: true }))) return;
            const resData = await Api.saveEquipment('delete', 'components', { id: materialForm.value.id });
            if(resData.success) { data.value = resData.data; showMaterialModal.value = false; }
        };
        const deleteMaterialDirect = async (comp) => {
            if (!(await showConfirm({ message: t('frontend.delete_confirm'), isDanger: true }))) return;
            const resData = await Api.saveEquipment('delete', 'components', { id: comp.id });
            if(resData.success) { data.value = resData.data; }
        };

        const showCompleteModal = ref(false);
        const activeTask = ref(null);
        const completeForm = ref({
            id: null,
            taskId: null,
            taskName: '',
            completionDate: dayjs().format('YYYY-MM-DD'),
            completionTime: dayjs().format('HH:mm'),
            comment: '',
            cost: 0,
            selectedMaterials: []
        });

        const openCompleteTask = (task) => {
            if (!task) return;
            activeTask.value = task;
            currentEquipmentId.value = task.equipmentId;

            const preselected = [];
            const reqComps = ensureArray(task.requiredComponents);
            reqComps.forEach(name => {
                const comp = (data.value.components || []).find(c => c.name === name && c.equipmentId === task.equipmentId);
                preselected.push({
                    id: comp ? comp.id : 'manual-' + Math.random().toString(36).substr(2, 9),
                    name: name,
                    cost: comp ? (comp.cost || 0) : 0
                });
            });

            completeForm.value = {
                id: null,
                taskId: task.id,
                taskName: task.taskName,
                completionDate: dayjs().format('YYYY-MM-DD'),
                completionTime: dayjs().format('HH:mm'),
                comment: '',
                cost: task.estimatedCost || 0,
                selectedMaterials: preselected
            };
            showCompleteModal.value = true;
        };

        const openHistoryEdit = (entry) => {
            activeTask.value = null;
            if (entry) {
                currentEquipmentId.value = entry.equipmentId;
                
                completeForm.value = {
                    id: entry.id,
                    taskId: entry.taskId,
                    taskName: entry.taskName,
                    completionDate: toDateInput(entry.completionDate),
                    completionTime: entry.completionTime || '12:00',
                    comment: entry.comment || '',
                    cost: entry.cost || 0,
                    selectedMaterials: ensureArray(entry.usedComponents).map(m => {
                        const comp = (data.value.components || []).find(c => c.name === m.name && c.equipmentId === entry.equipmentId);
                        return {
                            id: comp ? comp.id : 'manual-' + Math.random().toString(36).substr(2, 9),
                            name: m.name,
                            cost: m.cost || 0
                        };
                    })
                };
            } else {
                completeForm.value = {
                    id: null,
                    taskId: null,
                    taskName: '',
                    completionDate: dayjs().format('YYYY-MM-DD'),
                    completionTime: dayjs().format('HH:mm'),
                    comment: '',
                    cost: 0,
                    selectedMaterials: []
                };
            }
            showCompleteModal.value = true;
        };

        const addUsedMaterial = (compId) => {
            if (!compId) return;
            if (compId === 'ADD_CUSTOM') {
                const name = prompt(t('frontend.enter_material_name_prompt') || 'Введите название материала:');
                if (name) {
                    completeForm.value.selectedMaterials.push({
                        id: 'custom-' + Date.now(),
                        name: name,
                        cost: 0
                    });
                }
                return;
            }
            const comp = (data.value.components || []).find(c => c.id === compId);
            if (comp && !completeForm.value.selectedMaterials.some(m => m.id === compId)) {
                completeForm.value.selectedMaterials.push({
                    id: comp.id,
                    name: comp.name,
                    cost: comp.cost || 0
                });
            }
        };

        const removeUsedMaterial = (compId) => {
            completeForm.value.selectedMaterials = completeForm.value.selectedMaterials.filter(m => m.id !== compId);
        };

        const calculateGrandTotal = () => {
            const materialTotal = completeForm.value.selectedMaterials.reduce((acc, m) => acc + (parseFloat(m.cost) || 0), 0);
            return materialTotal + (parseFloat(completeForm.value.cost) || 0);
        };

        const submitCompletion = async () => {
            const materialCost = completeForm.value.selectedMaterials.reduce((acc, m) => acc + (parseFloat(m.cost) || 0), 0);
            const payload = {
                taskId: completeForm.value.taskId,
                history: {
                    id: completeForm.value.id,
                    equipmentId: currentEquipmentId.value || (data.value.tasks.find(t => t.id === completeForm.value.taskId)?.equipmentId),
                    taskName: completeForm.value.taskName,
                    completionDate: dayjs(completeForm.value.completionDate).format('YYYY-MM-DD'),
                    completionTime: completeForm.value.completionTime,
                    comment: completeForm.value.comment,
                    cost: parseFloat(completeForm.value.cost),
                    materialCost: materialCost,
                    usedComponents: completeForm.value.selectedMaterials.map(m => ({ name: m.name, cost: parseFloat(m.cost) }))
                }
            };
            const mode = completeForm.value.id ? 'save' : 'complete_task';
            const resData = await Api.saveEquipment(mode, 'history', payload);
            if(resData.success) { data.value = resData.data; showCompleteModal.value = false; }
        };

        const deleteHistoryEntry = async () => {
            if (!(await showConfirm({ message: t('frontend.delete_confirm'), isDanger: true }))) return;
            const resData = await Api.saveEquipment('delete', 'history', { id: completeForm.value.id });
            if(resData.success) { data.value = resData.data; showCompleteModal.value = false; }
        };

        const deleteHistoryEntryDirect = async (entry) => {
            if (!(await showConfirm({ message: t('frontend.delete_confirm'), isDanger: true }))) return;
            const resData = await Api.saveEquipment('delete', 'history', { id: entry.id });
            if(resData.success) { data.value = resData.data; }
        };

        const showWizard = ref(false);
        const wizardTab = ref('ai');
        const wizardState = ref('idle');
        const wizardIsExpanded = ref(false);
        const wizardData = ref({ modelName: '', pdfUrl: '' });
        const haSearchQuery = ref('');
        const processingMessage = ref('');
        const processingProgress = ref(0);
        const manualForm = ref({ name: '', brand: '', model: '', type: '', location: '', installationDate: dayjs().format('YYYY-MM-DD'), pdfUrl: '' });

        const isProcessing = computed(() => wizardState.value === 'processing');

        // Logic for AI processing icons
        const processingIcon = computed(() => {
            const msg = (processingMessage.value || "").toLowerCase();
            if (msg.includes('loading') || msg.includes('загрузка')) return 'download';
            if (msg.includes('reading') || msg.includes('extracting') || msg.includes('чтение') || msg.includes('извлечение')) return 'find_in_page';
            if (msg.includes('sending') || msg.includes('отправка')) return 'cloud_upload';
            if (msg.includes('analyzing') || msg.includes('studying') || msg.includes('анализ') || msg.includes('изучает')) return 'auto_awesome';
            if (msg.includes('merging') || msg.includes('saving') || msg.includes('объединение') || msg.includes('сохранение')) return 'inventory';
            return 'sync';
        });

        const processingIconClass = computed(() => {
            const icon = processingIcon.value;
            if (icon === 'download') return 'anim-bounce-y';
            if (icon === 'cloud_upload') return 'anim-bounce-x';
            if (icon === 'inventory') return 'anim-pulse';
            return 'anim-spin';
        });

        const openWizard = () => {
            showWizard.value = true;
            if (wizardState.value === 'processing') {
                wizardTab.value = 'ai';
            } else {
                wizardState.value = 'idle';
                wizardTab.value = 'ai';
                wizardIsExpanded.value = false;
                wizardData.value = { modelName: '', pdfUrl: '' };
                manualForm.value = { name: '', brand: '', model: '', type: '', location: data.value.locations[0]?.name || '', installationDate: dayjs().format('YYYY-MM-DD'), pdfUrl: '' };
                haSearchQuery.value = '';
            }
            refreshAiStatus();
        };

        const closeWizard = () => { showWizard.value = false; };

        const refreshHaDevices = async () => {
            if (isProcessing.value) return;
            try {
                const json = await Api.getData();
                data.value.ha_devices = json.ha_devices;
            } catch (e) {
                console.error("Failed to refresh HA devices", e);
            }
        };

        watch(wizardTab, (newTab) => {
            if (newTab === 'ha') {
                refreshHaDevices();
            }
        });

        // Load packages when purchase modal opens
        watch(showPurchaseModal, async (newVal) => {
            if (newVal && packages.value.length === 0) {
                await loadPackages();
            }
        });

        // Reload packages when language changes (if modal is open)
        watch(lang, async (newLang, oldLang) => {
            if (showPurchaseModal.value && oldLang) {
                console.log('[Purchase] Language changed, reloading packages...');
                await loadPackages();
            }
        });

        const filteredHaDevices = computed(() => {
            const query = haSearchQuery.value.toLowerCase().trim();
            if (!query) return data.value.ha_devices || [];
            return (data.value.ha_devices || []).filter(dev =>
                (dev.name || '').toLowerCase().includes(query) ||
                (dev.brand || '').toLowerCase().includes(query) ||
                (dev.model || '').toLowerCase().includes(query) ||
                (dev.area || '').toLowerCase().includes(query)
            );
        });

        const processUrl = async (url) => {
            if (isProcessing.value) return;
            wizardState.value = 'processing';
            wizardData.value.pdfUrl = url;
            processingMessage.value = t('frontend.downloading_instruction_msg') || "Загрузка инструкции...";
            try {
                if (typeof pdfjsLib !== 'undefined') {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                }

                const arrayBuffer = await Api.downloadFile(url);
                processingMessage.value = t('frontend.extracting_text_msg') || 'Извлечение текста...';

                const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
                const pdf = await loadingTask.promise;

                let fullText = "";
                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    fullText += textContent.items.map(item => item.str).join(" ") + "\n";
                }
                await startAnalysis(fullText);
            } catch (e) {
                console.error("Process URL error:", e);
                let errorMsg = e.message || String(e);

                // Extract user-friendly message from error using translations
                if (errorMsg.includes('403')) {
                    errorMsg = t('frontend.error_pdf_403');
                } else if (errorMsg.includes('404')) {
                    errorMsg = t('frontend.error_pdf_404');
                } else if (errorMsg.includes('timeout') || errorMsg.includes('408')) {
                    errorMsg = t('frontend.error_pdf_timeout');
                } else if (errorMsg.includes('500')) {
                    errorMsg = t('frontend.error_pdf_500');
                } else {
                    errorMsg = t('frontend.error_pdf_generic');
                }

                alert(errorMsg);
                wizardState.value = 'idle';
            }
        };

        const startAnalysis = async (text) => {
            processingMessage.value = t('frontend.sending_to_ai_msg') || 'Отправка в ИИ...';
            processingProgress.value = 0.2;
            try {
                const job = await Api.startAnalysis(text, wizardData.value.modelName, lang.value);
                localStorage.setItem('instrumatic_active_job_id', job.job_id);
                pollJob(job.job_id);
            } catch (e) { alert(e.message); wizardState.value = 'idle'; }
        };

        const pollJob = async (jobId) => {
            const check = async () => {
                if (wizardState.value !== 'processing') {
                    localStorage.removeItem('instrumatic_active_job_id');
                    return;
                }

                try {
                    const status = await Api.checkJobStatus(jobId);
                    if (status.status === 'completed') {
                        localStorage.removeItem('instrumatic_active_job_id');
                        await saveResult(status.result);
                        return;
                    }
                    else if (status.status === 'failed') {
                        localStorage.removeItem('instrumatic_active_job_id');
                        alert(status.error || "AI Failed");
                        wizardState.value = 'idle';
                        return;
                    }

                    if (status.is_normalizing) {
                        processingMessage.value = t('frontend.final_merging_msg') || 'Финальное объединение...';
                        processingProgress.value = 0.9;
                    } else if (status.total_chunks > 0) {
                        processingProgress.value = 0.4 + (status.processed_chunks / status.total_chunks) * 0.5;
                        // Start display counter from 1: (processed + 1) / total
                        const currentChunk = Math.min(status.processed_chunks + 1, status.total_chunks);
                        processingMessage.value = (t('frontend.ai_studying_msg') || 'ИИ изучает документ...') + ` (${currentChunk}/${status.total_chunks})`;
                    }
                    setTimeout(check, 3000);
                } catch (e) { setTimeout(check, 5000); }
            };
            check();
        };

        const abortAnalysis = async () => {
            if (await showConfirm({ message: t('frontend.interrupt_action') + '?', isDanger: true })) {
                wizardState.value = 'idle';
                localStorage.removeItem('instrumatic_active_job_id');
            }
        };

        const saveResult = async (result) => {
            console.log('[AI Result] Full result from backend:', JSON.stringify(result, null, 2));
            
            const payload = {
                equipment: {
                    name: wizardData.value.modelName || result.model || result.name,
                    brand: result.brand,
                    model: result.model,
                    type: result.type,
                    location: manualForm.value.location || '',
                    installationDate: manualForm.value.installationDate,
                    importantRules: ensureArray(result.important_rules),
                    documentationUrl: wizardData.value.pdfUrl || result.manual_url || ''
                },
                // Map tasks with their required components from AI response
                tasks: (result.maintenance_schedule || []).map(t => {
                    const requiredComponents = ensureArray(t.required_components || t.requiredComponents || []);
                    console.log('[AI Result] Task:', t.task_name, 'Required components:', requiredComponents);
                    return {
                        taskName: t.task_name,
                        periodicity: t.periodicity,
                        instructions: ensureArray(t.instructions),
                        isOneTime: !!t.isOneTime,
                        estimatedCost: 0,
                        // Include required components from AI response
                        requiredComponents: requiredComponents
                    };
                }),
                components: (result.components || []).map(c => ({
                    name: c.name,
                    description: c.description,
                    quantity: c.quantity,
                    partNumber: c.part_number,
                    cost: c.cost
                }))
            };
            console.log('[AI Result] Payload to save:', JSON.stringify(payload, null, 2));
            
            const resData = await Api.saveEquipment('save_batch', 'equipment', payload);
            console.log('[AI Result] Save response:', resData);
            
            if(resData.success) {
                // Properly update reactive data
                data.value.equipment = resData.data.equipment || [];
                data.value.tasks = resData.data.tasks || [];
                data.value.components = resData.data.components || [];
                data.value.history = resData.data.history || [];
                data.value.locations = resData.data.locations || [];

                showWizard.value = false;
                wizardState.value = 'idle';
                await refreshAiStatus();

                // Force close wizard and return to main screen
                setTimeout(() => {
                    currentEquipmentId.value = null;
                }, 100);
            }
        };

        const selectHaDevice = (dev) => {
            if (isProcessing.value) return;
            manualForm.value = {
                name: dev.name,
                brand: dev.brand || '',
                model: dev.model || '',
                type: dev.type || '',
                location: dev.area || '',
                installationDate: dayjs().format('YYYY-MM-DD'),
                pdfUrl: ''
            };
            wizardData.value.modelName = [dev.brand, dev.model].filter(x => x).join(' ') || dev.name;
            wizardTab.value = 'manual';
        };

        const saveManual = async () => {
            if (isProcessing.value) return;
            const payload = {
                equipment: { ...manualForm.value, documentationUrl: manualForm.value.pdfUrl, propertyId: 'default' },
                tasks: [],
                components: []
            };
            const resData = await Api.saveEquipment('save_batch', 'equipment', payload);
            if(resData.success) { data.value = resData.data; showWizard.value = false; }
        };

        // Report State
        const showReportModal = ref(false);
        const isReportGenerated = ref(false);
        const reportForm = ref({
            startDate: dayjs().subtract(1, 'year').format('YYYY-MM-DD'),
            endDate: dayjs().format('YYYY-MM-DD'),
            equipmentId: null
        });
        const reportResults = ref([]);
        const reportTotalCost = ref(0);

        const openReportDialog = () => {
            reportForm.value = {
                startDate: dayjs().subtract(1, 'year').format('YYYY-MM-DD'),
                endDate: dayjs().format('YYYY-MM-DD'),
                equipmentId: currentEquipmentId.value // Pre-select if on details screen
            };
            isReportGenerated.value = false;
            showReportModal.value = true;
        };

        const generateReport = () => {
            const start = dayjs(reportForm.value.startDate).startOf('day');
            const end = dayjs(reportForm.value.endDate).endOf('day');

            reportResults.value = data.value.history
                .filter(h => {
                    const hDate = dayjs(h.completionDate, ['YYYY-MM-DD', 'DD.MM.YYYY']);
                    const inRange = hDate.isBetween(start, end, null, '[]');
                    const matchesEq = !reportForm.value.equipmentId || h.equipmentId === reportForm.value.equipmentId;
                    return inRange && matchesEq;
                })
                .map(h => {
                    const eq = data.value.equipment.find(e => e.id === h.equipmentId);
                    return {
                        ...h,
                        equipmentName: eq ? eq.name : 'Unknown'
                    };
                })
                .sort((a, b) => dayjs(b.completionDate, ['YYYY-MM-DD', 'DD.MM.YYYY']).unix() - dayjs(a.completionDate, ['YYYY-MM-DD', 'DD.MM.YYYY']).unix());
            
            reportTotalCost.value = reportResults.value.reduce((acc, h) => acc + (h.cost || 0) + (h.materialCost || 0), 0);
            isReportGenerated.value = true;
        };

        // Info Page Logic
        const getRequestsLabel = (count) => {
            if (lang.value === 'ru') {
                const n = Math.abs(count) % 100;
                const n1 = n % 10;
                if (n > 10 && n < 20) return t('frontend.requests_label_5');
                if (n1 > 1 && n1 < 5) return t('frontend.requests_label_2');
                if (n1 === 1) return t('frontend.requests_label_1');
                return t('frontend.requests_label_5');
            }
            return count === 1 ? 'request' : 'requests';
        };

        const getEstCostLabel = () => {
            const label = t('frontend.est_cost');
            const currency = t('frontend.currency_symbol');
            return label.replace('{{currency_symbol}}', currency);
        };

        // Format periodicity with proper pluralization
        const formatPeriodicity = (periodicity) => {
            if (!periodicity) return '';
            
            // Handle compound periodicities like "1 месяц или 300 часов"
            const alternatives = periodicity.split(/\s*(?:или|or)\s*/i);
            
            const formatSingle = (period) => {
                const match = period.match(/(\d+)\s*(год|лет|г\.|мес|нед|дн|день|дня|дней|час|часа|часов|hour|hours|day|days|week|weeks|month|months|year|years)/i);
                if (!match) return period;
                
                const num = parseInt(match[1]);
                const unit = match[2].toLowerCase();
                
                if (lang.value === 'ru') {
                    // Russian pluralization
                    const lastDigit = num % 10;
                    const lastTwoDigits = num % 100;
                    
                    if (unit.includes('год') || unit.includes('г')) {
                        if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return `${num} лет`;
                        if (lastDigit === 1) return `${num} год`;
                        if (lastDigit >= 2 && lastDigit <= 4) return `${num} года`;
                        return `${num} лет`;
                    }
                    if (unit.includes('мес')) {
                        if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return `${num} месяцев`;
                        if (lastDigit === 1) return `${num} месяц`;
                        if (lastDigit >= 2 && lastDigit <= 4) return `${num} месяца`;
                        return `${num} месяцев`;
                    }
                    if (unit.includes('нед')) {
                        if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return `${num} недель`;
                        if (lastDigit === 1) return `${num} неделя`;
                        if (lastDigit >= 2 && lastDigit <= 4) return `${num} недели`;
                        return `${num} недель`;
                    }
                    if (unit.includes('дн') || unit.includes('день')) {
                        if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return `${num} дней`;
                        if (lastDigit === 1) return `${num} день`;
                        if (lastDigit >= 2 && lastDigit <= 4) return `${num} дня`;
                        return `${num} дней`;
                    }
                    if (unit.includes('час')) {
                        if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return `${num} часов`;
                        if (lastDigit === 1) return `${num} час`;
                        if (lastDigit >= 2 && lastDigit <= 4) return `${num} часа`;
                        return `${num} часов`;
                    }
                } else {
                    // English pluralization
                    if (unit.includes('hour')) {
                        return `${num} hour${num !== 1 ? 's' : ''}`;
                    }
                    if (unit.includes('day')) {
                        return `${num} day${num !== 1 ? 's' : ''}`;
                    }
                    if (unit.includes('week')) {
                        return `${num} week${num !== 1 ? 's' : ''}`;
                    }
                    if (unit.includes('month')) {
                        return `${num} month${num !== 1 ? 's' : ''}`;
                    }
                    if (unit.includes('year')) {
                        return `${num} year${num !== 1 ? 's' : ''}`;
                    }
                }
                
                return period;
            };
            
            // Format each alternative and join with " or " / " или "
            const formatted = alternatives.map(alt => formatSingle(alt.trim()));
            return formatted.join(lang.value === 'ru' ? ' или ' : ' or ');
        };

        const copyToClipboard = (text) => {
            navigator.clipboard.writeText(text).then(() => {
                alert(t('frontend.code_copied_msg') || 'Copied');
            });
        };

        const generateTransferCode = async () => {
            isGeneratingCode.value = true;
            try {
                const res = await Api.proxyRequest('POST', 'transfer/generate');
                if (res && res.code) {
                    transferCode.value = res.code;
                }
            } catch (e) {
                alert(t('frontend.network_error'));
            } finally {
                isGeneratingCode.value = false;
            }
        };

        const applyTransferCode = async () => {
            isApplyingCode.value = true;
            try {
                await Api.proxyRequest('POST', 'transfer/apply', { code: enterCodeInput.value });
                alert(t('frontend.attempts_transferred_success'));
                showEnterCodeModal.value = false;
                enterCodeInput.value = '';
                await refreshAiStatus();
            } catch (e) {
                alert(t('frontend.invalid_code_expired'));
            } finally {
                isApplyingCode.value = false;
            }
        };

        // Purchase functions
        const formatPrice = (price, currency) => {
            const symbol = currency === 'RUB' ? '₽' : currency === 'USD' ? '$' : currency === 'EUR' ? '€' : currency;
            if (symbol.length === 1) {
                return symbol === '$' ? `$${price}` : `${price} ${symbol}`;
            }
            return `${price} ${symbol}`;
        };

        const loadPackages = async () => {
            purchaseLoading.value = true;
            purchaseMessage.value = '';
            try {
                // Check if payments are enabled
                try {
                    const versionRes = await Api.proxyRequest('GET', 'version');
                    isPaymentsEnabled.value = versionRes?.payments_enabled !== false;
                    console.log('[Purchase] Payments enabled:', isPaymentsEnabled.value);
                } catch (e) {
                    console.warn('Failed to check payments status:', e);
                }

                // Load packages with locale parameter (backend returns locale-specific packages)
                const locale = lang.value === 'ru' ? 'ru' : 'en';
                const loadedPackages = await Api.proxyRequest('GET', `packages?locale=${locale}`);
                console.log('[Purchase] Loaded packages for locale', locale, ':', loadedPackages);
                packages.value = Array.isArray(loadedPackages) ? loadedPackages : [];
            } catch (e) {
                console.error('Failed to load packages:', e);
                purchaseMessage.value = t('frontend.error_loading_packages') || 'Ошибка загрузки пакетов';
            } finally {
                purchaseLoading.value = false;
            }
        };

        const buyPackage = async (pkg) => {
            console.log('[Purchase] buyPackage called with:', pkg);
            if (!isPaymentsEnabled.value || purchaseProcessing.value) return;

            purchaseProcessing.value = true;
            purchaseMessage.value = '';
            purchaseSuccess.value = false;

            try {
                // package_id must be sent as query parameter, not body (same as Android client)
                const paymentPath = `payments/create?package_id=${encodeURIComponent(pkg.id)}`;
                console.log('[Purchase] Calling proxy with path:', paymentPath);
                const response = await Api.proxyRequest('POST', paymentPath, null);
                console.log('[Purchase] Response:', response);
                if (response.confirmation_url) {
                    pendingPaymentId.value = response.payment_id;
                    // Open payment URL in new window/tab
                    window.open(response.confirmation_url, '_blank');
                    // Start polling payment status
                    pollPaymentStatus(response.payment_id);
                } else {
                    console.error('[Purchase] No confirmation_url in response:', response);
                    purchaseMessage.value = t('frontend.payment_creation_error') || 'Ошибка создания платежа';
                }
            } catch (e) {
                console.error('[Purchase] Error object:', e);
                console.error('[Purchase] Error type:', typeof e);
                console.error('[Purchase] Error keys:', Object.keys(e || {}));
                let errorMsg = 'Ошибка оплаты';
                if (typeof e === 'string') {
                    errorMsg = e;
                } else if (e.message) {
                    errorMsg = e.message;
                } else if (e.detail) {
                    errorMsg = e.detail;
                } else if (e.error) {
                    errorMsg = e.error;
                } else {
                    try {
                        errorMsg = JSON.stringify(e, null, 2);
                    } catch (stringifyError) {
                        errorMsg = 'Неизвестная ошибка';
                    }
                }
                console.error('[Purchase] Final error message:', errorMsg);
                purchaseMessage.value = errorMsg;
            } finally {
                purchaseProcessing.value = false;
            }
        };

        const pollPaymentStatus = async (paymentId) => {
            let attempts = 0;
            const maxAttempts = 60; // 5 minutes max (60 * 5 seconds)

            while (attempts < maxAttempts && pendingPaymentId.value) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay

                try {
                    const status = await Api.proxyRequest('GET', `payments/${paymentId}`);
                    if (status.status === 'succeeded') {
                        purchaseSuccess.value = true;
                        purchaseMessage.value = '';
                        pendingPaymentId.value = null;
                        await refreshAiStatus(); // Update balance
                        break;
                    } else if (status.status === 'canceled') {
                        purchaseMessage.value = t('frontend.payment_canceled') || 'Платеж отменен';
                        pendingPaymentId.value = null;
                        break;
                    }
                } catch (e) {
                    console.warn('Payment status check failed:', e);
                }

                attempts++;
            }

            if (attempts >= maxAttempts && pendingPaymentId.value) {
                purchaseMessage.value = t('frontend.payment_timeout') || 'Время ожидания платежа истекло';
                pendingPaymentId.value = null;
            }

            purchaseProcessing.value = false;
        };

        const closePurchaseModal = () => {
            if (purchaseProcessing.value) return; // Don't close while processing
            showPurchaseModal.value = false;
            purchaseMessage.value = '';
            purchaseSuccess.value = false;
            // Clear pending payment if any
            if (pendingPaymentId.value) {
                pendingPaymentId.value = null;
            }
        };

        return {
            t, lang, isLoaded, data, confirmDialog, currentEquipmentId, selectedLocation, detailTab,
            headerTitle, goBack,
            expandedTasks, toggleTask, showRules, isProcessing, showUpcomingTasks, upcomingTasks,
            showEditModal, editForm, showTaskModal, taskForm, showMaterialModal, materialForm, showCompleteModal, activeTask, completeForm,
            showWizard, wizardTab, wizardState, wizardIsExpanded, wizardData, haSearchQuery, filteredHaDevices, processingMessage, processingProgress, manualForm,
            processingIcon, processingIconClass,
            filteredEquipment, equipmentWithDates, currentItem, currentTasks, currentComponents, currentHistory, dayjs,
            getStatusClass, getStatusColor, openDetails, editEquipment, copyEquipment, saveEquipment, deleteEquipment, deleteEquipmentDirect,
            openTaskEdit, saveTask, deleteTask, deleteTaskDirect, openMaterialEdit, saveMaterial, deleteMaterial, deleteMaterialDirect,
            openCompleteTask, submitCompletion, openWizard, closeWizard, processUrl, selectHaDevice, saveManual,
            addTaskMaterial, removeTaskMaterial, addUsedMaterial, removeUsedMaterial, calculateGrandTotal, openHistoryEdit, deleteHistoryEntry, deleteHistoryEntryDirect,
            refreshHaDevices, abortAnalysis,
            showReportModal, isReportGenerated, reportForm, reportResults, reportTotalCost, openReportDialog, generateReport,
            showAppInfo, userKey, transferCode, enterCodeInput, isGeneratingCode, isApplyingCode, showEnterCodeModal, getRequestsLabel, getEstCostLabel, copyToClipboard, generateTransferCode, applyTransferCode,
            showPurchaseModal, packages, purchaseLoading, purchaseProcessing, purchaseMessage, purchaseSuccess, isPaymentsEnabled,
            formatPrice, loadPackages, buyPackage, closePurchaseModal,
            formatDate, toDateInput, formatPeriodicity
        };
    }
});

if (window.INSTRUMATIC_MOUNT_POINT) {
    app.mount(window.INSTRUMATIC_MOUNT_POINT);
} else {
    app.mount('#app');
}
