// index.js - Enhanced Slack Bot with Airtable Integration
require('dotenv').config();
const { App, ExpressReceiver } = require('@slack/bolt');
const fetch = require('node-fetch');

// Create a custom Express receiver for better control
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET || 'dummy-secret-for-health-check',
  // Process events immediately (don't queue)
  processBeforeResponse: true
});

// Add health check endpoints BEFORE initializing the Slack app
// Railway uses healthcheck.railway.app hostname for health checks
receiver.router.get('/', (req, res) => {
  res.status(200).send('Slack bot is running! 🤖');
});

receiver.router.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Add a test endpoint
receiver.router.get('/test', (req, res) => {
  res.status(200).json({
    message: 'Server is running',
    env: {
      has_slack_token: !!process.env.SLACK_BOT_TOKEN,
      has_signing_secret: !!process.env.SLACK_SIGNING_SECRET,
      has_airtable_base: !!process.env.AIRTABLE_BASE_ID,
      port: process.env.PORT || 3000
    }
  });
});

// Initialize Slack app with custom receiver
const app = new App({
  token: process.env.SLACK_BOT_TOKEN || 'xoxb-dummy-token',
  receiver,
  // Add logging
  logLevel: process.env.LOG_LEVEL || 'info'
});


// Airtable configuration
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const PROJECTS_TABLE_ID = process.env.AIRTABLE_PROJECTS_TABLE_ID;
const EMPLOYEES_TABLE_ID = process.env.AIRTABLE_EMPLOYEES_TABLE_ID;

// Field constants for the corrected schema
const PRIORITY_VALUES = {
  'Highest - ETD next 30 days': { order: 1, emoji: '🔴' },
  'High - ETD EoQ3': { order: 2, emoji: '🟠' },
  'Medium - ETD EoQ4': { order: 3, emoji: '🟡' },
  'Low - ETD TBD (possible spill over)': { order: 4, emoji: '🟢' }
};

const STATUS_VALUES = {
  'Not started': { emoji: '⚪' },
  'In progress': { emoji: '🔵' },
  'Delivered': { emoji: '🟢' },
  'Cancelled': { emoji: '❌' },
  'Deprecated': { emoji: '⚫' }
};

const RELATED_BU_OPTIONS = [
  'P1', 'Exclusives', 'Mortgage', 'GV', 'Company level', 'Blocks', 'Mint'
];

const RELATED_OKR_OPTIONS = [
  'O1 KR1 - Mint/Blocks Growth',
  'O1 KR2 - Mortgage Growth',
  'O1 KR3 - Exclusives Growth',
  'O1 KR4 - GV Growth',
  'O2 KR1 - Mint App',
  'O2 KR2 - P1',
  'O2 KR3 - Appro',
  'O2 KR4 - Brokers Hub',
  'O2 KR5 - AI',
  'O3 KR1 - Internal efficiency',
  'O3 KR2 - CX',
  'O4 KR1 - Tech hiring',
  'O4 KR2 - eNPS'
];

// ===== AIRTABLE HELPER FUNCTIONS =====

async function airtableFetch(endpoint, options = {}) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${AIRTABLE_API_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Airtable API error: ${JSON.stringify(error)}`);
  }
  
  return response.json();
}

async function getAllProjects(filter = null, sort = null) {
  let allRecords = [];
  let offset = null;
  
  do {
    const params = new URLSearchParams({
      pageSize: '100',
      ...(filter && { filterByFormula: filter }),
      ...(offset && { offset })
    });
    
    // Add sorting if specified
    if (sort && sort.field) {
      params.append('sort[0][field]', sort.field);
      params.append('sort[0][direction]', sort.direction || 'asc');
    }
    
    const data = await airtableFetch(`${PROJECTS_TABLE_ID}?${params.toString()}`);
    allRecords = allRecords.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  
  return allRecords;
}

async function searchProjects(searchTerm, filters = {}) {
  let filterFormulas = [];
  
  // Add search term filter
  if (searchTerm) {
    filterFormulas.push(`OR(FIND(LOWER("${searchTerm}"), LOWER({Initiative})), FIND(LOWER("${searchTerm}"), LOWER({Description})))`);
  }
  
  // Add status filter
  if (filters.status && filters.status !== 'all') {
    filterFormulas.push(`{Status} = "${filters.status}"`);
  }
  
  // Add priority filter
  if (filters.priority && filters.priority !== 'all') {
    filterFormulas.push(`{Priority} = "${filters.priority}"`);
  }
  
  // Add BU filter
  if (filters.bu && filters.bu !== 'all') {
    filterFormulas.push(`FIND("${filters.bu}", {Related BU})`);
  }
  
  // Add OKR filter
  if (filters.okr && filters.okr !== 'all') {
    filterFormulas.push(`FIND("${filters.okr}", {Related OKR})`);
  }
  
  // Add owners filter - for multiple selected owners (using Project Owners field)
  if (filters.owners && filters.owners.length > 0) {
    const ownerFilters = filters.owners.map(ownerId => 
      `FIND("${ownerId}", ARRAYJOIN({Project Owners}))`
    );
    filterFormulas.push(`OR(${ownerFilters.join(', ')})`);
  }
  
  // Add Slack ID filter - for filtering by current user's Slack ID
  if (filters.slackUserId) {
    console.log('Filtering by Slack ID:', filters.slackUserId);
    // Convert lookup field array to string using &'' then use FIND
    filterFormulas.push(`FIND("${filters.slackUserId}", {Slack IDs}&'')`);
  }
  
  // Combine all filters with AND
  const finalFilter = filterFormulas.length > 0 
    ? `AND(${filterFormulas.join(', ')})` 
    : '';
  
  // Get projects and sort by target date on client side (since not all records have target date)
  console.log('Final Airtable filter:', finalFilter);
  const projects = await getAllProjects(finalFilter);
  console.log(`Found ${projects.length} projects after filtering`);
  
  // Sort by target date (earliest first), projects without dates go to the end
  return projects.sort((a, b) => {
    const dateA = a.fields['Target date'] ? new Date(a.fields['Target date']) : new Date('2099-12-31');
    const dateB = b.fields['Target date'] ? new Date(b.fields['Target date']) : new Date('2099-12-31');
    return dateA - dateB;
  });
}

async function getProject(recordId) {
  return airtableFetch(`${PROJECTS_TABLE_ID}/${recordId}`);
}

async function createProject(fields) {
  return airtableFetch(`${PROJECTS_TABLE_ID}`, {
    method: 'POST',
    body: JSON.stringify({ fields })
  });
}

async function updateProject(recordId, fields) {
  return airtableFetch(`${PROJECTS_TABLE_ID}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields })
  });
}

async function deleteProject(recordId) {
  return airtableFetch(`${PROJECTS_TABLE_ID}/${recordId}`, {
    method: 'DELETE'
  });
}

async function getEmployees() {
  const params = new URLSearchParams({
    pageSize: '100',
    'sort[0][field]': 'Name',
    'sort[0][direction]': 'asc'
  });
  
  const data = await airtableFetch(`${EMPLOYEES_TABLE_ID}?${params.toString()}`);
  return data.records || [];
}

// ===== SLACK HELPER FUNCTIONS =====

function formatProjectForSlack(project, compact = false) {
  const fields = project.fields;
  const initiative = fields['Initiative'] || 'Unnamed Project';
  const status = fields['Status'] || 'Not started';
  const priority = fields['Priority'] || 'Medium - ETD EoQ4';
  const description = fields['Description'] || 'No description';
  const lastUpdate = fields['Last updated'] ? new Date(fields['Last updated']).toLocaleDateString() : 'Never';
  const targetDate = fields['Target date'] ? new Date(fields['Target date']).toLocaleDateString() : null;
  const nextMilestone = fields['Next milestone'] || '';
  
  // Get owners from the Owner(s) field (which contains names as a string)
  const owners = fields['Owner(s)'] || 'Unassigned';
  
  // Get Related BU and OKR
  const relatedBU = fields['Related BU'] || [];
  const relatedOKR = fields['Related OKR'] || [];
  
  // Create status and priority emojis
  const statusEmoji = STATUS_VALUES[status]?.emoji || '⚪';
  const priorityEmoji = PRIORITY_VALUES[priority]?.emoji || '⚪';
  
  if (compact) {
    // Enhanced compact format for list view - showing all important info
    let text = `${statusEmoji} *${initiative}*\n`;
    text += `${priorityEmoji} Priority: ${priority}\n`;
    text += `📊 Status: ${status}\n`;
    text += `👥 Owners: ${owners}\n`;
    text += `📅 Last Update: ${lastUpdate}`;
    
    if (targetDate) {
      text += `\n🎯 Target: ${targetDate}`;
    }
    
    if (relatedBU.length > 0) {
      text += `\n🏢 BU: ${relatedBU.join(', ')}`;
    }
    
    // Show actual OKR names if only a few, otherwise show count
    if (relatedOKR.length > 0) {
      if (relatedOKR.length <= 2) {
        text += `\n🎯 OKR: ${relatedOKR.join(', ')}`;
      } else {
        text += `\n🎯 OKR: ${relatedOKR.length} linked`;
      }
    }
    
    return {
      id: project.id,
      initiative,
      text,
      description,
      priorityOrder: PRIORITY_VALUES[priority]?.order || 999
    };
  } else {
    // Full format for detailed view
    let text = `${statusEmoji} *${initiative}*\n`;
    text += `${priorityEmoji} Priority: ${priority}\n`;
    text += `📊 Status: ${status}\n`;
    text += `👥 Owners: ${owners}\n`;
    text += `📅 Last Update: ${lastUpdate}`;
    
    if (targetDate) {
      text += `\n🎯 Target: ${targetDate}`;
    }
    
    if (nextMilestone) {
      text += `\n📍 Next Milestone: ${nextMilestone}`;
    }
    
    if (relatedBU.length > 0) {
      text += `\n🏢 BU: ${relatedBU.join(', ')}`;
    }
    
    if (relatedOKR.length > 0) {
      text += `\n🎯 OKR: ${relatedOKR.join(', ')}`;
    }
    
    return {
      id: project.id,
      initiative,
      text,
      description,
      priorityOrder: PRIORITY_VALUES[priority]?.order || 999
    };
  }
}

// ===== SLASH COMMAND HANDLERS =====

app.command('/project', async ({ command, ack, respond, client }) => {
  await ack();
  
  const text = (command.text || '').trim();
  const [action, ...searchTerms] = text.split(/\s+/);
  const searchTerm = searchTerms.join(' ');
  
  try {
    switch (action) {
      case 'list':
      case 'view':
        await showFilterModal(client, command.trigger_id, searchTerm);
        break;
        
      case 'edit':
        await showProjectListForEdit(respond, command.user_id, searchTerm);
        break;
        
      case 'delete':
        await showProjectList(respond, 'delete', searchTerm);
        break;
        
      case 'create':
      case 'new':
        await showCreateProjectModal(client, command.trigger_id);
        break;
        
      case 'help':
        await showHelp(respond);
        break;
        
      default:
        await showFilterModal(client, command.trigger_id, text);
    }
  } catch (error) {
    console.error('Command error:', error);
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error: ${error.message}`
    });
  }
});

async function showFilterModal(client, triggerId, initialSearch = '') {
  const employees = await getEmployees();
  const ownerOptions = [
    { text: { type: 'plain_text', text: 'All Owners' }, value: 'all' },
    ...employees.map(emp => ({
      text: { type: 'plain_text', text: emp.fields['Name'] || 'Unknown' },
      value: emp.fields['Name'] || 'unknown'
    }))
  ];
  
  const buOptions = [
    { text: { type: 'plain_text', text: 'All Business Units' }, value: 'all' },
    ...RELATED_BU_OPTIONS.map(bu => ({
      text: { type: 'plain_text', text: bu },
      value: bu
    }))
  ];
  
  const okrOptions = [
    { text: { type: 'plain_text', text: 'All OKRs' }, value: 'all' },
    ...RELATED_OKR_OPTIONS.map(okr => ({
      text: { type: 'plain_text', text: okr.length > 30 ? okr.substring(0, 30) + '...' : okr },
      value: okr
    }))
  ];
  
  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'filter_projects_modal',
      title: { type: 'plain_text', text: 'Filter Projects' },
      submit: { type: 'plain_text', text: 'Apply Filters' },
      close: { type: 'plain_text', text: 'Cancel' },
      private_metadata: JSON.stringify({ initialSearch }),
      blocks: [
        {
          type: 'input',
          block_id: 'search_block',
          label: { type: 'plain_text', text: 'Search Term' },
          element: {
            type: 'plain_text_input',
            action_id: 'search_input',
            placeholder: { type: 'plain_text', text: 'Search by initiative or description...' },
            initial_value: initialSearch
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'status_block',
          label: { type: 'plain_text', text: 'Status' },
          element: {
            type: 'static_select',
            action_id: 'status_select',
            initial_option: { text: { type: 'plain_text', text: 'All Statuses' }, value: 'all' },
            options: [
              { text: { type: 'plain_text', text: 'All Statuses' }, value: 'all' },
              ...Object.keys(STATUS_VALUES).map(status => ({
                text: { type: 'plain_text', text: status },
                value: status
              }))
            ]
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'priority_block',
          label: { type: 'plain_text', text: 'Priority' },
          element: {
            type: 'static_select',
            action_id: 'priority_select',
            initial_option: { text: { type: 'plain_text', text: 'All Priorities' }, value: 'all' },
            options: [
              { text: { type: 'plain_text', text: 'All Priorities' }, value: 'all' },
              ...Object.keys(PRIORITY_VALUES).map(priority => ({
                text: { type: 'plain_text', text: priority },
                value: priority
              }))
            ]
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'bu_block',
          label: { type: 'plain_text', text: 'Related Business Unit' },
          element: {
            type: 'static_select',
            action_id: 'bu_select',
            initial_option: buOptions[0],
            options: buOptions
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'okr_block',
          label: { type: 'plain_text', text: 'Related OKR' },
          element: {
            type: 'static_select',
            action_id: 'okr_select',
            initial_option: okrOptions[0],
            options: okrOptions
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'owner_block',
          label: { type: 'plain_text', text: 'Owner(s)' },
          element: {
            type: 'multi_static_select',
            action_id: 'owner_select',
            placeholder: { type: 'plain_text', text: 'Select project owners' },
            options: ownerOptions.slice(1), // Remove "All Owners" option for multi-select
            max_selected_items: 10
          },
          optional: true
        }
      ]
    }
  });
}

async function showProjectListForEdit(respond, userId, searchTerm = '') {
  try {
    const projects = await searchProjects(searchTerm, { slackUserId: userId });
    
    if (projects.length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: `No projects found where you are a member${searchTerm ? ` matching "${searchTerm}"` : ''}.`
      });
      return;
    }
    
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Found ${projects.length} project(s) where you are a member:*`
        }
      },
      { type: 'divider' }
    ];
    
    // Add filter summary if there's a search term
    if (searchTerm) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `_Search: "${searchTerm}" • Your projects only_`
        }]
      });
      blocks.push({ type: 'divider' });
    }
    
    // Add projects with pagination
    const projectsPerPage = 8;
    const currentPage = 0; // Start with page 0
    const startIndex = currentPage * projectsPerPage;
    const endIndex = startIndex + projectsPerPage;
    const paginatedProjects = projects.slice(startIndex, endIndex);
    
    for (const project of paginatedProjects) {
      const formatted = formatProjectForSlack(project, true); // Use compact format
      
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: formatted.text },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ Edit' },
          action_id: 'edit_project',
          value: project.id
        }
      });
      
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🗑️ Delete' },
            action_id: 'delete_project',
            value: project.id,
            style: 'danger',
            confirm: {
              title: { type: 'plain_text', text: 'Confirm Deletion' },
              text: { type: 'mrkdwn', text: `Are you sure you want to delete *${formatted.initiative}*?` },
              confirm: { type: 'plain_text', text: 'Delete' },
              deny: { type: 'plain_text', text: 'Cancel' }
            }
          }
        ]
      });
    }
    
    // Add pagination info and navigation
    const totalPages = Math.ceil(projects.length / projectsPerPage);
    const showingStart = startIndex + 1;
    const showingEnd = Math.min(endIndex, projects.length);
    
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `_Showing ${showingStart}-${showingEnd} of ${projects.length} projects (Page ${currentPage + 1} of ${totalPages})_`
      }]
    });
    
    // Add navigation buttons if there are multiple pages
    if (totalPages > 1) {
      const navigationElements = [];
      
      // Previous button (disabled on first page)
      if (currentPage > 0) {
        navigationElements.push({
          type: 'button',
          text: { type: 'plain_text', text: '◀ Previous' },
          action_id: 'edit_projects_prev_page',
          value: JSON.stringify({ 
            searchTerm,
            slackUserId: userId,
            page: currentPage - 1
          })
        });
      }
      
      // Next button (disabled on last page)
      if (currentPage < totalPages - 1) {
        navigationElements.push({
          type: 'button',
          text: { type: 'plain_text', text: 'Next ▶' },
          action_id: 'edit_projects_next_page',
          value: JSON.stringify({ 
            searchTerm,
            slackUserId: userId,
            page: currentPage + 1
          })
        });
      }
      
      if (navigationElements.length > 0) {
        blocks.push({
          type: 'actions',
          elements: navigationElements
        });
      }
    }
    
    await respond({
      response_type: 'in_channel',
      blocks
    });
    
  } catch (error) {
    console.error('Edit project list error:', error);
    await respond({
      response_type: 'ephemeral',
      text: `❌ Error loading projects: ${error.message}`
    });
  }
}

async function showProjectList(respond, action, searchTerm = '', slackUserId = null) {
  const filters = {};
  if (slackUserId && action === 'edit') {
    filters.slackUserId = slackUserId;
  }
  const projects = await searchProjects(searchTerm, filters);
  
  if (projects.length === 0) {
    let message = 'No projects found';
    if (action === 'edit' && slackUserId) {
      message = 'No projects found where you are a member';
    }
    if (searchTerm) {
      message += ` matching "${searchTerm}"`;
    }
    message += '.';
    
    await respond({
      response_type: 'ephemeral',
      text: message
    });
    return;
  }
  
  let headerText = `*Select a project to ${action}:*`;
  if (action === 'edit' && slackUserId) {
    headerText = `*Select a project to ${action} (your projects only):*`;
  }
  if (searchTerm) {
    headerText += ` (filtered by "${searchTerm}")`;
  }
  
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: headerText
      }
    },
    { type: 'divider' }
  ];
  
  // Add project blocks
  for (const project of projects.slice(0, 10)) { // Limit to 10 for performance
    const formatted = formatProjectForSlack(project);
    
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: formatted.text },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: action === 'edit' ? '✏️ Edit' : '🗑️ Delete' },
        action_id: `${action}_project`,
        value: project.id,
        ...(action === 'delete' && {
          style: 'danger',
          confirm: {
            title: { type: 'plain_text', text: 'Confirm Deletion' },
            text: { type: 'mrkdwn', text: `Are you sure you want to delete *${formatted.initiative}*?` },
            confirm: { type: 'plain_text', text: 'Delete' },
            deny: { type: 'plain_text', text: 'Cancel' }
          }
        })
      }
    });
  }
  
  if (projects.length > 10) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_Showing 10 of ${projects.length} projects. Use filters for more specific results._`
        }
      ]
    });
  }
  
  await respond({
    response_type: 'ephemeral',
    blocks
  });
}

async function showCreateProjectModal(client, triggerId) {
  const employees = await getEmployees();
  const ownerOptions = employees.map(emp => ({
    text: { type: 'plain_text', text: emp.fields['Name'] || 'Unknown' },
    value: emp.id // Use record ID for linked records
  }));
  
  const buOptions = RELATED_BU_OPTIONS.map(bu => ({
    text: { type: 'plain_text', text: bu },
    value: bu
  }));
  
  const okrOptions = RELATED_OKR_OPTIONS.map(okr => ({
    text: { type: 'plain_text', text: okr.length > 75 ? okr.substring(0, 72) + '...' : okr },
    value: okr
  }));
  
  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'submit_project_create',
      title: { type: 'plain_text', text: 'Create New Project' },
      submit: { type: 'plain_text', text: 'Create Project' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'initiative_block',
          label: { type: 'plain_text', text: 'Initiative Name' },
          element: {
            type: 'plain_text_input',
            action_id: 'initiative_input',
            placeholder: { type: 'plain_text', text: 'Enter project initiative name' }
          }
        },
        {
          type: 'input',
          block_id: 'description_block',
          label: { type: 'plain_text', text: 'Description' },
          element: {
            type: 'plain_text_input',
            action_id: 'description_input',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'Enter project description' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'status_block',
          label: { type: 'plain_text', text: 'Status' },
          element: {
            type: 'static_select',
            action_id: 'status_input',
            initial_option: {
              text: { type: 'plain_text', text: 'Not started' },
              value: 'Not started'
            },
            options: Object.keys(STATUS_VALUES).map(s => ({
              text: { type: 'plain_text', text: s },
              value: s
            }))
          }
        },
        {
          type: 'input',
          block_id: 'priority_block',
          label: { type: 'plain_text', text: 'Priority' },
          element: {
            type: 'static_select',
            action_id: 'priority_input',
            initial_option: {
              text: { type: 'plain_text', text: 'Medium - ETD EoQ4' },
              value: 'Medium - ETD EoQ4'
            },
            options: Object.keys(PRIORITY_VALUES).map(p => ({
              text: { type: 'plain_text', text: p },
              value: p
            }))
          }
        },
        {
          type: 'input',
          block_id: 'bu_block',
          label: { type: 'plain_text', text: 'Related Business Unit' },
          element: {
            type: 'multi_static_select',
            action_id: 'bu_input',
            options: buOptions,
            placeholder: { type: 'plain_text', text: 'Select related BUs' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'okr_block',
          label: { type: 'plain_text', text: 'Related OKR' },
          element: {
            type: 'multi_static_select',
            action_id: 'okr_input',
            options: okrOptions,
            placeholder: { type: 'plain_text', text: 'Select related OKRs' },
            max_selected_items: 10
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'owners_block',
          label: { type: 'plain_text', text: 'Project Owners' },
          element: {
            type: 'multi_static_select',
            action_id: 'owners_input',
            options: ownerOptions,
            placeholder: { type: 'plain_text', text: 'Select project owners' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'kpis_block',
          label: { type: 'plain_text', text: 'KPIs (how to measure success?)' },
          element: {
            type: 'plain_text_input',
            action_id: 'kpis_input',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'Enter key performance indicators' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'risks_block',
          label: { type: 'plain_text', text: 'Risks/Blockers' },
          element: {
            type: 'plain_text_input',
            action_id: 'risks_input',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'Enter project risks and mitigation strategies' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'next_milestone_block',
          label: { type: 'plain_text', text: 'Next Milestone' },
          element: {
            type: 'plain_text_input',
            action_id: 'next_milestone_input',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'Describe the next milestone for this project' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'target_date_block',
          label: { type: 'plain_text', text: 'Target Date' },
          element: {
            type: 'datepicker',
            action_id: 'target_date_input',
            placeholder: { type: 'plain_text', text: 'Select target completion date' }
          },
          optional: true
        }
      ]
    }
  });
}

async function showHelp(respond) {
  await respond({
    response_type: 'ephemeral',
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*📋 Project Management Commands*'
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '• `/project` or `/project list` - View all projects with filters\n' +
                '• `/project create` or `/project new` - Create a new project\n' +
                '• `/project edit [search]` - Edit a project\n' +
                '• `/project delete [search]` - Delete a project\n' +
                '• `/project help` - Show this help message'
        }
      },
      {
        type: 'divider'
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '*Priority Legend:*\n🔴 Highest (ETD next 30 days)\n🟠 High (ETD EoQ3)\n🟡 Medium (ETD EoQ4)\n🟢 Low (ETD TBD)'
          }
        ]
      }
    ]
  });
}

// ===== VIEW SUBMISSION HANDLERS =====

app.view('filter_projects_modal', async ({ ack, body, view, client }) => {
  await ack();
  
  const values = view.state.values;
  const searchTerm = values.search_block?.search_input?.value || '';
  const status = values.status_block?.status_select?.selected_option?.value || 'all';
  const priority = values.priority_block?.priority_select?.selected_option?.value || 'all';
  const bu = values.bu_block?.bu_select?.selected_option?.value || 'all';
  const okr = values.okr_block?.okr_select?.selected_option?.value || 'all';
  const owners = values.owner_block?.owner_select?.selected_options?.map(o => o.value) || [];
  
  try {
    const projects = await searchProjects(searchTerm, { status, priority, bu, okr, owners });
    
    if (projects.length === 0) {
      await client.chat.postEphemeral({
        channel: body.user.id,
        user: body.user.id,
        text: 'No projects found with the specified filters.'
      });
      return;
    }
    
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Found ${projects.length} project(s):*`
        }
      },
      { type: 'divider' }
    ];
    
    // Add filter summary
    const activeFilters = [];
    if (searchTerm) activeFilters.push(`Search: "${searchTerm}"`);
    if (status !== 'all') activeFilters.push(`Status: ${status}`);
    if (priority !== 'all') activeFilters.push(`Priority: ${priority}`);
    if (bu !== 'all') activeFilters.push(`BU: ${bu}`);
    if (okr !== 'all') activeFilters.push(`OKR: ${okr}`);
    if (owners.length > 0) activeFilters.push(`Owners: ${owners.length} selected`);
    
    if (activeFilters.length > 0) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `_Filters: ${activeFilters.join(' • ')}_`
        }]
      });
      blocks.push({ type: 'divider' });
    }
    
    // Add projects with pagination
    const projectsPerPage = 8;
    const currentPage = 0; // Start with page 0
    const startIndex = currentPage * projectsPerPage;
    const endIndex = startIndex + projectsPerPage;
    const paginatedProjects = projects.slice(startIndex, endIndex);
    
    for (const project of paginatedProjects) {
      const formatted = formatProjectForSlack(project, true); // Use compact format
      
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: formatted.text },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ Edit' },
          action_id: 'edit_project',
          value: project.id
        }
      });
      
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🗑️ Delete' },
            action_id: 'delete_project',
            value: project.id,
            style: 'danger',
            confirm: {
              title: { type: 'plain_text', text: 'Confirm Deletion' },
              text: { type: 'mrkdwn', text: `Are you sure you want to delete *${formatted.initiative}*?` },
              confirm: { type: 'plain_text', text: 'Delete' },
              deny: { type: 'plain_text', text: 'Cancel' }
            }
          }
        ]
      });
    }
    
    // Add pagination info and navigation
    const totalPages = Math.ceil(projects.length / projectsPerPage);
    const showingStart = startIndex + 1;
    const showingEnd = Math.min(endIndex, projects.length);
    
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `_Showing ${showingStart}-${showingEnd} of ${projects.length} projects (Page ${currentPage + 1} of ${totalPages})_`
      }]
    });
    
    // Add navigation buttons if there are multiple pages
    if (totalPages > 1) {
      const navigationElements = [];
      
      // Previous button (disabled on first page)
      if (currentPage > 0) {
        navigationElements.push({
          type: 'button',
          text: { type: 'plain_text', text: '◀ Previous' },
          action_id: 'projects_prev_page',
          value: JSON.stringify({ 
            filters: { searchTerm, status, priority, bu, okr, owners },
            page: currentPage - 1
          })
        });
      }
      
      // Next button (disabled on last page)
      if (currentPage < totalPages - 1) {
        navigationElements.push({
          type: 'button',
          text: { type: 'plain_text', text: 'Next ▶' },
          action_id: 'projects_next_page',
          value: JSON.stringify({ 
            filters: { searchTerm, status, priority, bu, okr, owners },
            page: currentPage + 1
          })
        });
      }
      
      if (navigationElements.length > 0) {
        blocks.push({
          type: 'actions',
          elements: navigationElements
        });
      }
    }
    
    await client.chat.postMessage({
      channel: body.user.id,
      blocks
    });
    
  } catch (error) {
    console.error('Filter error:', error);
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: `❌ Error applying filters: ${error.message}`
    });
  }
});

// ===== ACTION HANDLERS =====

app.action('edit_project', async ({ ack, body, client, action }) => {
  await ack();
  
  try {
    const project = await getProject(action.value);
    const employees = await getEmployees();
    const fields = project.fields || {};
    
    // Create owner options from employees - for linked records we need record IDs
    const ownerOptions = employees.map(emp => ({
      text: { type: 'plain_text', text: emp.fields['Name'] || 'Unknown' },
      value: emp.id // Use record ID for linked records
    }));
    
    // Use the correct linked record field name "Project Owners"
    const currentOwnerIds = fields['Project Owners'] || [];
    console.log('Project Owners field (linked records):', currentOwnerIds);
    console.log('Type:', Array.isArray(currentOwnerIds) ? 'array' : typeof currentOwnerIds);
    
    const selectedOwners = ownerOptions.filter(opt => 
      Array.isArray(currentOwnerIds) ? currentOwnerIds.includes(opt.value) : false
    );
    console.log('Selected owners for modal:', selectedOwners);
    
    // Create BU options
    const buOptions = RELATED_BU_OPTIONS.map(bu => ({
      text: { type: 'plain_text', text: bu },
      value: bu
    }));
    
    const currentBUs = fields['Related BU'] || [];
    const selectedBUs = buOptions.filter(opt => 
      currentBUs.includes(opt.value)
    );
    
    // Create OKR options
    const okrOptions = RELATED_OKR_OPTIONS.map(okr => ({
      text: { type: 'plain_text', text: okr.length > 75 ? okr.substring(0, 72) + '...' : okr },
      value: okr
    }));
    
    const currentOKRs = fields['Related OKR'] || [];
    const selectedOKRs = okrOptions.filter(opt => 
      currentOKRs.includes(opt.value)
    );
    
    const modal = {
      type: 'modal',
      callback_id: 'submit_project_edit',
      private_metadata: action.value,
      title: { type: 'plain_text', text: 'Edit Project' },
      submit: { type: 'plain_text', text: 'Save Changes' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'input',
          block_id: 'initiative_block',
          label: { type: 'plain_text', text: 'Initiative Name' },
          element: {
            type: 'plain_text_input',
            action_id: 'initiative_input',
            initial_value: fields['Initiative'] || '',
            placeholder: { type: 'plain_text', text: 'Enter project initiative name' }
          }
        },
        {
          type: 'input',
          block_id: 'description_block',
          label: { type: 'plain_text', text: 'Description' },
          element: {
            type: 'plain_text_input',
            action_id: 'description_input',
            multiline: true,
            initial_value: fields['Description'] || '',
            placeholder: { type: 'plain_text', text: 'Enter project description' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'status_block',
          label: { type: 'plain_text', text: 'Status' },
          element: {
            type: 'static_select',
            action_id: 'status_input',
            initial_option: {
              text: { type: 'plain_text', text: fields['Status'] || 'Not started' },
              value: fields['Status'] || 'Not started'
            },
            options: Object.keys(STATUS_VALUES).map(s => ({
              text: { type: 'plain_text', text: s },
              value: s
            }))
          }
        },
        {
          type: 'input',
          block_id: 'priority_block',
          label: { type: 'plain_text', text: 'Priority' },
          element: {
            type: 'static_select',
            action_id: 'priority_input',
            initial_option: {
              text: { type: 'plain_text', text: fields['Priority'] || 'Medium - ETD EoQ4' },
              value: fields['Priority'] || 'Medium - ETD EoQ4'
            },
            options: Object.keys(PRIORITY_VALUES).map(p => ({
              text: { type: 'plain_text', text: p },
              value: p
            }))
          }
        },
        {
          type: 'input',
          block_id: 'bu_block',
          label: { type: 'plain_text', text: 'Related Business Unit' },
          element: {
            type: 'multi_static_select',
            action_id: 'bu_input',
            options: buOptions,
            initial_options: selectedBUs.length > 0 ? selectedBUs : undefined,
            placeholder: { type: 'plain_text', text: 'Select related BUs' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'okr_block',
          label: { type: 'plain_text', text: 'Related OKR' },
          element: {
            type: 'multi_static_select',
            action_id: 'okr_input',
            options: okrOptions,
            initial_options: selectedOKRs.length > 0 ? selectedOKRs : undefined,
            placeholder: { type: 'plain_text', text: 'Select related OKRs' },
            max_selected_items: 10
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'owners_block',
          label: { type: 'plain_text', text: 'Owner(s)' },
          element: {
            type: 'multi_static_select',
            action_id: 'owners_input',
            options: ownerOptions,
            initial_options: selectedOwners.length > 0 ? selectedOwners : undefined,
            placeholder: { type: 'plain_text', text: 'Select project owners' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'kpis_block',
          label: { type: 'plain_text', text: 'KPIs (how to measure success?)' },
          element: {
            type: 'plain_text_input',
            action_id: 'kpis_input',
            multiline: true,
            initial_value: fields['KPIs (how to measure success?)'] || '',
            placeholder: { type: 'plain_text', text: 'Enter key performance indicators' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'risks_block',
          label: { type: 'plain_text', text: 'Risks/Blockers' },
          element: {
            type: 'plain_text_input',
            action_id: 'risks_input',
            multiline: true,
            initial_value: fields['Risks/Blockers'] || '',
            placeholder: { type: 'plain_text', text: 'Enter project risks and mitigation strategies' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'next_milestone_block',
          label: { type: 'plain_text', text: 'Next Milestone' },
          element: {
            type: 'plain_text_input',
            action_id: 'next_milestone_input',
            multiline: true,
            initial_value: fields['Next milestone'] || '',
            placeholder: { type: 'plain_text', text: 'Describe the next milestone for this project' }
          },
          optional: true
        },
        {
          type: 'input',
          block_id: 'target_date_block',
          label: { type: 'plain_text', text: 'Target Date' },
          element: {
            type: 'datepicker',
            action_id: 'target_date_input',
            initial_date: fields['Target date'] || undefined,
            placeholder: { type: 'plain_text', text: 'Select target completion date' }
          },
          optional: true
        }
      ]
    };
    
    await client.views.open({
      trigger_id: body.trigger_id,
      view: modal
    });
    
  } catch (error) {
    console.error('Edit modal error:', error);
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: `❌ Error opening edit modal: ${error.message}`
    });
  }
});

app.view('submit_project_create', async ({ ack, body, view, client }) => {
  await ack();
  
  const values = view.state.values;
  
  try {
    // Create the project fields - using correct Airtable field names
    const projectFields = {
      'Initiative': values.initiative_block.initiative_input.value,
      'Description': values.description_block?.description_input?.value || '',
      'Status': values.status_block.status_input.selected_option.value,
      'Priority': values.priority_block.priority_input.selected_option.value,
      'Related BU': values.bu_block?.bu_input?.selected_options?.map(o => o.value) || [],
      'Related OKR': values.okr_block?.okr_input?.selected_options?.map(o => o.value) || [],
      'Project Owners': values.owners_block?.owners_input?.selected_options?.map(o => o.value) || [], // These are record IDs for linked records
      'KPIs (how to measure success?)': values.kpis_block?.kpis_input?.value || '',
      'Risks/Blockers': values.risks_block?.risks_input?.value || '',
      'Next milestone': values.next_milestone_block?.next_milestone_input?.value || '',
      'Last updated': new Date().toISOString().split('T')[0] // Date format YYYY-MM-DD
    };
    
    // Add target date if provided
    if (values.target_date_block?.target_date_input?.selected_date) {
      projectFields['Target date'] = values.target_date_block.target_date_input.selected_date;
    }
    
    const newProject = await createProject(projectFields);
    
    await client.chat.postMessage({
      channel: body.user.id,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Successfully created project *${projectFields.Initiative}*`
          }
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `📋 **Project Details:**\n• Status: ${projectFields.Status}\n• Priority: ${projectFields.Priority}\n• Owners: ${values.owners_block?.owners_input?.selected_options?.length || 0} assigned`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Created on ${new Date().toLocaleDateString()} by <@${body.user.id}> | Project ID: ${newProject.id}`
            }
          ]
        }
      ]
    });
    
  } catch (error) {
    console.error('Create project error:', error);
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: `❌ Error creating project: ${error.message}`
    });
  }
});

app.view('submit_project_edit', async ({ ack, body, view, client }) => {
  await ack();
  
  const recordId = view.private_metadata;
  const values = view.state.values;
  
  try {
    const updatedFields = {
      'Initiative': values.initiative_block.initiative_input.value,
      'Description': values.description_block?.description_input?.value || '',
      'Status': values.status_block.status_input.selected_option.value,
      'Priority': values.priority_block.priority_input.selected_option.value,
      'Related BU': values.bu_block?.bu_input?.selected_options?.map(o => o.value) || [],
      'Related OKR': values.okr_block?.okr_input?.selected_options?.map(o => o.value) || [],
      'Project Owners': values.owners_block?.owners_input?.selected_options?.map(o => o.value) || [], // These are record IDs for linked records
      'KPIs (how to measure success?)': values.kpis_block?.kpis_input?.value || '',
      'Risks/Blockers': values.risks_block?.risks_input?.value || '',
      'Next milestone': values.next_milestone_block?.next_milestone_input?.value || '',
      'Last updated': new Date().toISOString().split('T')[0] // Date format YYYY-MM-DD
    };

    // Add target date if provided
    if (values.target_date_block?.target_date_input?.selected_date) {
      updatedFields['Target date'] = values.target_date_block.target_date_input.selected_date;
    }
    
    await updateProject(recordId, updatedFields);
    
    await client.chat.postMessage({
      channel: body.user.id,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ Successfully updated project *${updatedFields.Initiative}*`
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `Updated on ${new Date().toLocaleDateString()} by <@${body.user.id}>`
            }
          ]
        }
      ]
    });
    
  } catch (error) {
    console.error('Update error:', error);
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: `❌ Error updating project: ${error.message}`
    });
  }
});

app.action('delete_project', async ({ ack, body, action, client }) => {
  await ack();
  
  try {
    await deleteProject(action.value);
    
    await client.chat.postMessage({
      channel: body.user.id,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: '🗑️ Project successfully deleted'
          }
        }
      ]
    });
    
  } catch (error) {
    console.error('Delete error:', error);
    await client.chat.postEphemeral({
      channel: body.user.id,
      user: body.user.id,
      text: `❌ Error deleting project: ${error.message}`
    });
  }
});

// ===== PAGINATION HANDLERS =====

async function showProjectsPage(client, userId, filters, currentPage) {
  try {
    const { searchTerm, status, priority, bu, okr, owners } = filters;
    const projects = await searchProjects(searchTerm, { status, priority, bu, okr, owners });
    
    if (projects.length === 0) {
      await client.chat.postEphemeral({
        channel: userId,
        user: userId,
        text: 'No projects found with the specified filters.'
      });
      return;
    }
    
    const projectsPerPage = 8;
    const startIndex = currentPage * projectsPerPage;
    const endIndex = startIndex + projectsPerPage;
    const paginatedProjects = projects.slice(startIndex, endIndex);
    
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Found ${projects.length} project(s):*`
        }
      },
      { type: 'divider' }
    ];
    
    // Add filter summary if filters are active
    const activeFilters = [];
    if (searchTerm) activeFilters.push(`Search: "${searchTerm}"`);
    if (status !== 'all') activeFilters.push(`Status: ${status}`);
    if (priority !== 'all') activeFilters.push(`Priority: ${priority}`);
    if (bu !== 'all') activeFilters.push(`BU: ${bu}`);
    if (okr !== 'all') activeFilters.push(`OKR: ${okr}`);
    if (owners.length > 0) activeFilters.push(`Owners: ${owners.length} selected`);
    
    if (activeFilters.length > 0) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `_Filters: ${activeFilters.join(' • ')}_`
        }]
      });
      blocks.push({ type: 'divider' });
    }
    
    // Add projects
    for (const project of paginatedProjects) {
      const formatted = formatProjectForSlack(project, true);
      
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: formatted.text },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ Edit' },
          action_id: 'edit_project',
          value: project.id
        }
      });
      
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🗑️ Delete' },
            action_id: 'delete_project',
            value: project.id,
            style: 'danger',
            confirm: {
              title: { type: 'plain_text', text: 'Confirm Deletion' },
              text: { type: 'mrkdwn', text: `Are you sure you want to delete *${formatted.initiative}*?` },
              confirm: { type: 'plain_text', text: 'Delete' },
              deny: { type: 'plain_text', text: 'Cancel' }
            }
          }
        ]
      });
    }
    
    // Add pagination info and navigation
    const totalPages = Math.ceil(projects.length / projectsPerPage);
    const showingStart = startIndex + 1;
    const showingEnd = Math.min(endIndex, projects.length);
    
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `_Showing ${showingStart}-${showingEnd} of ${projects.length} projects (Page ${currentPage + 1} of ${totalPages})_`
      }]
    });
    
    // Add navigation buttons
    if (totalPages > 1) {
      const navigationElements = [];
      
      if (currentPage > 0) {
        navigationElements.push({
          type: 'button',
          text: { type: 'plain_text', text: '◀ Previous' },
          action_id: 'projects_prev_page',
          value: JSON.stringify({ 
            filters: { searchTerm, status, priority, bu, okr, owners },
            page: currentPage - 1
          })
        });
      }
      
      if (currentPage < totalPages - 1) {
        navigationElements.push({
          type: 'button',
          text: { type: 'plain_text', text: 'Next ▶' },
          action_id: 'projects_next_page',
          value: JSON.stringify({ 
            filters: { searchTerm, status, priority, bu, okr, owners },
            page: currentPage + 1
          })
        });
      }
      
      if (navigationElements.length > 0) {
        blocks.push({
          type: 'actions',
          elements: navigationElements
        });
      }
    }
    
    await client.chat.postMessage({
      channel: userId,
      blocks
    });
    
  } catch (error) {
    console.error('Pagination error:', error);
    await client.chat.postEphemeral({
      channel: userId,
      user: userId,
      text: `❌ Error loading projects: ${error.message}`
    });
  }
}

app.action('projects_next_page', async ({ ack, body, action, client }) => {
  await ack();
  
  try {
    const { filters, page } = JSON.parse(action.value);
    await showProjectsPage(client, body.user.id, filters, page);
  } catch (error) {
    console.error('Next page error:', error);
  }
});

app.action('projects_prev_page', async ({ ack, body, action, client }) => {
  await ack();
  
  try {
    const { filters, page } = JSON.parse(action.value);
    await showProjectsPage(client, body.user.id, filters, page);
  } catch (error) {
    console.error('Previous page error:', error);
  }
});

// Edit projects pagination handlers
app.action('edit_projects_next_page', async ({ ack, body, action, client }) => {
  await ack();
  
  try {
    const { searchTerm, slackUserId, page } = JSON.parse(action.value);
    await showEditProjectsPage(client, slackUserId, searchTerm, page);
  } catch (error) {
    console.error('Edit projects next page error:', error);
  }
});

app.action('edit_projects_prev_page', async ({ ack, body, action, client }) => {
  await ack();
  
  try {
    const { searchTerm, slackUserId, page } = JSON.parse(action.value);
    await showEditProjectsPage(client, slackUserId, searchTerm, page);
  } catch (error) {
    console.error('Edit projects previous page error:', error);
  }
});

async function showEditProjectsPage(client, userId, searchTerm, currentPage) {
  try {
    const projects = await searchProjects(searchTerm, { slackUserId: userId });
    
    if (projects.length === 0) {
      await client.chat.postEphemeral({
        channel: userId,
        user: userId,
        text: `No projects found where you are a member${searchTerm ? ` matching "${searchTerm}"` : ''}.`
      });
      return;
    }
    
    const projectsPerPage = 8;
    const startIndex = currentPage * projectsPerPage;
    const endIndex = startIndex + projectsPerPage;
    const paginatedProjects = projects.slice(startIndex, endIndex);
    
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Found ${projects.length} project(s) where you are a member:*`
        }
      },
      { type: 'divider' }
    ];
    
    // Add filter summary if there's a search term
    if (searchTerm) {
      blocks.push({
        type: 'context',
        elements: [{
          type: 'mrkdwn',
          text: `_Search: "${searchTerm}" • Your projects only_`
        }]
      });
      blocks.push({ type: 'divider' });
    }
    
    // Add projects
    for (const project of paginatedProjects) {
      const formatted = formatProjectForSlack(project, true);
      
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: formatted.text },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: '✏️ Edit' },
          action_id: 'edit_project',
          value: project.id
        }
      });
      
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🗑️ Delete' },
            action_id: 'delete_project',
            value: project.id,
            style: 'danger',
            confirm: {
              title: { type: 'plain_text', text: 'Confirm Deletion' },
              text: { type: 'mrkdwn', text: `Are you sure you want to delete *${formatted.initiative}*?` },
              confirm: { type: 'plain_text', text: 'Delete' },
              deny: { type: 'plain_text', text: 'Cancel' }
            }
          }
        ]
      });
    }
    
    // Add pagination info and navigation
    const totalPages = Math.ceil(projects.length / projectsPerPage);
    const showingStart = startIndex + 1;
    const showingEnd = Math.min(endIndex, projects.length);
    
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `_Showing ${showingStart}-${showingEnd} of ${projects.length} projects (Page ${currentPage + 1} of ${totalPages})_`
      }]
    });
    
    // Add navigation buttons
    if (totalPages > 1) {
      const navigationElements = [];
      
      if (currentPage > 0) {
        navigationElements.push({
          type: 'button',
          text: { type: 'plain_text', text: '◀ Previous' },
          action_id: 'edit_projects_prev_page',
          value: JSON.stringify({ 
            searchTerm,
            slackUserId: userId,
            page: currentPage - 1
          })
        });
      }
      
      if (currentPage < totalPages - 1) {
        navigationElements.push({
          type: 'button',
          text: { type: 'plain_text', text: 'Next ▶' },
          action_id: 'edit_projects_next_page',
          value: JSON.stringify({ 
            searchTerm,
            slackUserId: userId,
            page: currentPage + 1
          })
        });
      }
      
      if (navigationElements.length > 0) {
        blocks.push({
          type: 'actions',
          elements: navigationElements
        });
      }
    }
    
    await client.chat.postMessage({
      channel: userId,
      blocks
    });
    
  } catch (error) {
    console.error('Edit projects pagination error:', error);
    await client.chat.postEphemeral({
      channel: userId,
      user: userId,
      text: `❌ Error loading projects: ${error.message}`
    });
  }
}

// ===== ERROR HANDLING =====

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit the process unless it's critical
});

// Graceful shutdown handling
let isShuttingDown = false;

process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('SIGTERM signal received: closing HTTP server gracefully');
  try {
    await app.stop();
    console.log('Slack app stopped successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log('SIGINT signal received: closing HTTP server gracefully');
  try {
    await app.stop();
    console.log('Slack app stopped successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

// ===== START THE APP =====

(async () => {
  try {
    const port = process.env.PORT || 3000;
    
    // Validate required environment variables
    const requiredEnvVars = [
      'SLACK_BOT_TOKEN',
      'SLACK_SIGNING_SECRET',
      'AIRTABLE_BASE_ID',
      'AIRTABLE_API_KEY',
      'AIRTABLE_PROJECTS_TABLE_ID',
      'AIRTABLE_EMPLOYEES_TABLE_ID'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables:', missingVars.join(', '));
      console.error('Please set all required environment variables in Railway');
      // Don't exit immediately to allow health checks to work
    }
    
    // Start the Slack app - Railway requires using PORT env var
    await app.start(port);
    
    console.log('⚡️ Slack bot is running in HTTP mode!');
    console.log(`📡 Listening on 0.0.0.0:${port}`);
    
    // Test if /slack/commands route exists by making a simple GET request
    console.log('🔍 Testing Slack routes...');
    receiver.router.get('/debug-routes', (_req, res) => {
      const routes = [];
      if (receiver.router && receiver.router.stack) {
        receiver.router.stack.forEach((layer) => {
          if (layer.route) {
            const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
            routes.push(`${methods} ${layer.route.path}`);
          }
        });
      }
      res.json({ routes });
    });
    console.log('🔗 Configure your Slack app with these URLs:');
    console.log(`   - Slash Commands: https://YOUR_RAILWAY_URL/slack/commands`);
    console.log(`   - Event Subscriptions: https://YOUR_RAILWAY_URL/slack/events`);
    console.log(`   - Interactivity: https://YOUR_RAILWAY_URL/slack/events`);
    
    if (AIRTABLE_BASE) {
      console.log('📊 Connected to Airtable base:', AIRTABLE_BASE);
    } else {
      console.warn('⚠️  Airtable base ID not configured');
    }
    
  } catch (error) {
    console.error('Failed to start app:', error);
    console.log('📡 Health check server available at health endpoints only (Slack features unavailable)');
    // Don't try to start receiver again - it's already started by app.start()
  }
})();