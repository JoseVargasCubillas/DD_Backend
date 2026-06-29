import { EVENT_STATUS } from '../../atoms/constants/status.constant.js';
import { createSqlModel, SqlDocumentMethods } from './sql-model.js';

export interface IEventDocument extends SqlDocumentMethods<IEventDocument> {
  title: string;
  slug: string;
  description: string;
  shortDescription: string;
  thumbnail: string;
  type: 'seminar' | 'workshop' | 'webinar' | 'conference';
  modality: 'in-person' | 'online' | 'hybrid';
  location: string;
  onlineUrl: string;
  startDate: Date | string;
  endDate: Date | string;
  price: number;
  salePrice?: number | null;
  capacity: number;
  registeredCount: number;
  status: string;
  instructor: string;
  attendees: string[];
  stripePriceId: string;
  isFeatured: boolean;
  agenda: { time: string; topic: string; speaker: string }[];
  createdAt: Date | string;
  updatedAt: Date | string;
}

export const Event = createSqlModel<IEventDocument>({
  table: 'events',
  defaults: () => ({
    shortDescription: '',
    thumbnail: '',
    type: 'seminar',
    modality: 'in-person',
    location: '',
    onlineUrl: '',
    salePrice: null,
    capacity: 0,
    registeredCount: 0,
    status: EVENT_STATUS.UPCOMING,
    attendees: [],
    stripePriceId: '',
    isFeatured: false,
    agenda: [],
  }),
});
