/** Public registry facts for Melstar Manufacturing Systems Pvt Ltd (same as the company website). */
export const COMPANY = {
  legal_name: 'Melstar Manufacturing Systems Private Limited',
  short_name: 'Melstar',
  cin: 'U29309KA2011PTC060656',
  incorporated_on: '2011-10-04',
  roc: 'RoC Bangalore',
  company_type: 'Private company limited by shares',
  company_category: 'Non-government company',
  listing_status: 'Indian · Unlisted',
  status: 'Active',
  authorised_capital: 10_000_000,
  paid_up_capital: 10_000_000,
  sectors: ['Heavy Machinery', 'Manufacturing Technology', 'Specialized Engineering'],
  business_activity:
    'Precision-engineered components and sub-assemblies through CNC machining, fabrication and customised industrial design.',
  registered_office: '1197, 6th Main Road, A Block, 2nd Stage, Rajajinagar, Bengaluru, Karnataka 560010',
  plant_address:
    'Plot No. 15, Road No. 3, KIADB Industrial Area Obadenahalli, Phase 3, Doddaballapura, Karnataka 562163',
  plant_lat: 13.2736, // decoded from plus code 7HFG+CR
  plant_lng: 77.5771,
  plus_code: '7HFG+CR Doddaballapura',
  website: 'https://indra9346.github.io/Melstar-Manufacturing-Systems/',
  directors: [
    {
      name: 'Sriranga Raghu',
      designation: 'Director',
      din: '02146175',
      appointed_on: '2020-12-31',
      other_directorships: ['Macurex Sensors Pvt Ltd', 'M Acer Automotive Systems Pvt Ltd'],
    },
    { name: 'Sriram Dhati Raghu', designation: 'Whole-time Director', din: '08763716', appointed_on: '2024-04-01', other_directorships: [] },
    { name: 'Dhati Raghu Srikar', designation: 'Whole-time Director', din: '03623554', appointed_on: '2024-04-01', other_directorships: [] },
  ],
} as const

export const STUDIO = {
  name: 'Swan Digital Solutions',
  url: 'https://swandigitalsolutions.com',
} as const
