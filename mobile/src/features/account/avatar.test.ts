import { ApiError } from '@/api/errors';

import { removeAvatar, uploadAvatar } from './avatar';

const mockApi = jest.fn();
const mockPost = jest.fn();
const mockPrepare = jest.fn();
const mockDelete = jest.fn();

jest.mock('@/api/client', () => ({ apiRequest: (...args: unknown[]) => mockApi(...args) }));
jest.mock('@/sync/photoUpload', () => ({ postToPresigned: (...args: unknown[]) => mockPost(...args) }));
jest.mock('@/features/photos/preparePhoto', () => ({
  prepareAvatar: (...args: unknown[]) => mockPrepare(...args),
  deleteLocalPhoto: (...args: unknown[]) => mockDelete(...args),
}));
jest.mock('@/lib/ids', () => ({ ulid: () => '01JCLIENTMUTATION0000000000' }));

const target = { uploadId: '01JUPLOAD000000000000000000', url: 'https://s3.example/upload', fields: { key: 'k' }, expiresAt: '', maxBytes: 1_048_576 };
const profile = { tenantId: 't', avatarUrl: 'https://s3.example/avatar.jpg' };

beforeEach(() => {
  jest.clearAllMocks();
  mockPrepare.mockResolvedValue({ localUri: 'file:///cache/avatar.jpg' });
});

describe('profile photo (avatar) upload', () => {
  it('makes a 512 square on the device, posts it to the presigned form and confirms it with PUT', async () => {
    mockApi.mockResolvedValueOnce(target).mockResolvedValueOnce(profile);
    mockPost.mockResolvedValue(204);

    await expect(uploadAvatar({ localUri: 'file:///picked.jpg', width: 3000, height: 4000 })).resolves.toEqual(profile);

    expect(mockPrepare).toHaveBeenCalledWith('file:///picked.jpg', 3000, 4000);
    expect(mockApi).toHaveBeenNthCalledWith(1, 'v1/tenant/profile/avatar/upload-url', { method: 'POST', body: { contentType: 'image/jpeg' } });
    expect(mockPost).toHaveBeenCalledWith('file:///cache/avatar.jpg', target);
    expect(mockApi).toHaveBeenNthCalledWith(2, 'v1/tenant/profile/avatar', {
      method: 'PUT',
      body: { uploadId: target.uploadId, clientMutationId: '01JCLIENTMUTATION0000000000' },
    });
    // Never the body / face photo endpoints.
    expect(mockApi.mock.calls.some(([path]) => String(path).startsWith('v1/tenant/photo'))).toBe(false);
    expect(mockDelete).toHaveBeenCalledWith('file:///cache/avatar.jpg');
  });

  it('a refused S3 upload is an error and nothing is confirmed; the local square is still removed', async () => {
    mockApi.mockResolvedValueOnce(target);
    mockPost.mockResolvedValue(403);
    await expect(uploadAvatar({ localUri: 'file:///picked.jpg', width: 800, height: 800 })).rejects.toBeInstanceOf(ApiError);
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith('file:///cache/avatar.jpg');
  });

  it('removing the photo is a DELETE', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    await removeAvatar();
    expect(mockApi).toHaveBeenCalledWith('v1/tenant/profile/avatar', { method: 'DELETE' });
  });
});
