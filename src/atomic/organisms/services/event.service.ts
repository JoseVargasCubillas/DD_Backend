import slugify from 'slugify';
import { Event, IEventDocument } from '../../molecules/models/event.model.js';
import { EVENT_STATUS } from '../../atoms/constants/status.constant.js';

const makeError = (msg: string, code: number): Error => Object.assign(new Error(msg), { statusCode: code });

export const createEvent = async (data: Partial<IEventDocument>): Promise<IEventDocument> => {
  const slug = slugify(data.title as string, { lower: true, strict: true });
  return Event.create({ ...data, slug });
};

export const listEvents = async ({ page = 1, limit = 10, status = EVENT_STATUS.UPCOMING } = {}) => {
  const [events, total] = await Promise.all([
    Event.find({ status }).populate('instructor', 'name avatar').skip((page - 1) * limit).limit(limit).sort('startDate'),
    Event.countDocuments({ status }),
  ]);
  return { events, total, page, pages: Math.ceil(total / limit) };
};

export const getEventBySlug = async (slug: string): Promise<IEventDocument> => {
  const event = await Event.findOne({ slug }).populate('instructor', 'name avatar bio');
  if (!event) throw makeError('Event not found', 404);
  return event;
};

export const updateEvent = async (id: string, data: Partial<IEventDocument>): Promise<IEventDocument | null> =>
  Event.findByIdAndUpdate(id, data, { new: true, runValidators: true });

export const registerToEvent = async (eventId: string, userId: string): Promise<IEventDocument> => {
  const event = await Event.findById(eventId);
  if (!event) throw makeError('Event not found', 404);
  if (event.capacity > 0 && event.registeredCount >= event.capacity)
    throw makeError('Event is full', 400);
  await Event.findByIdAndUpdate(eventId, { $addToSet: { attendees: userId }, $inc: { registeredCount: 1 } });
  return event;
};
