import { toUUIDString } from 'src/shared/infraestructure/mongo-uuid';
import { ApplicationForm } from '../domain/application-form';
import { ApplicationFormDoc } from '../infraestructure/application-form.schema';
import { GetApplicationFormDto } from '../presentation/dtos/get-application-form.dto';

export class ApplicationFormMapper {
  static toDb(form: ApplicationForm): ApplicationFormDoc {
    const { imageIds, ...props } = form.props;
    return imageIds ? { ...props, imageIds: [...imageIds] } : props;
  }

  static fromDb(doc: ApplicationFormDoc): ApplicationForm {
    return ApplicationForm.restore({
      imageIds: doc.imageIds?.length
        ? doc.imageIds.map(toUUIDString)
        : undefined,
      fursonaName: doc.fursonaName,
      species: doc.species,
      age: doc.age,
      city: doc.city,
      socialLinks: doc.socialLinks,
      howDidYouFindUs: doc.howDidYouFindUs,
      knowsSomeone: doc.knowsSomeone,
      previousMeets: doc.previousMeets,
    });
  }

  static toDto(form: ApplicationForm): GetApplicationFormDto {
    return { ...form.props, isMinor: form.isMinor };
  }
}
